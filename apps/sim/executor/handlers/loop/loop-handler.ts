import { createLogger } from '@/lib/logs/console/logger'
import type { BlockOutput } from '@/blocks/types'
import { BlockType } from '@/executor/consts'
import { evaluateConditionExpression } from '@/executor/handlers/condition/condition-handler'
import type { PathTracker } from '@/executor/path/path'
import type { InputResolver } from '@/executor/resolver/resolver'
import { Routing } from '@/executor/routing/routing'
import type { BlockHandler, ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('LoopBlockHandler')

const DEFAULT_MAX_ITERATIONS = 5

/**
 * Handler for loop blocks that manage iteration control and flow.
 * Loop blocks don't execute logic themselves but control the flow of blocks within them.
 */
export class LoopBlockHandler implements BlockHandler {
  constructor(
    private resolver?: InputResolver,
    private pathTracker?: PathTracker
  ) {}

  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === BlockType.LOOP
  }

  async execute(
    block: SerializedBlock,
    _inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<BlockOutput> {
    logger.info(`Executing loop block: ${block.id}`)

    const loop = context.workflow?.loops?.[block.id]
    if (!loop) {
      logger.error(`Loop configuration not found for block ${block.id}`, {
        blockId: block.id,
        availableLoops: Object.keys(context.workflow?.loops || {}),
        workflowLoops: context.workflow?.loops,
      })
      throw new Error(`Loop configuration not found for block ${block.id}`)
    }

    if (!context.loopIterations.has(block.id)) {
      context.loopIterations.set(block.id, 1)
      logger.info(`Initialized loop ${block.id} starting at iteration 1`)
    }

    const currentIteration = context.loopIterations.get(block.id) || 1
    let maxIterations: number
    let forEachItems: any[] | Record<string, any> | null = null
    let shouldContinueLoop = true

    if (loop.loopType === 'forEach') {
      if (
        !loop.forEachItems ||
        (typeof loop.forEachItems === 'string' && loop.forEachItems.trim() === '')
      ) {
        throw new Error(
          `forEach loop "${block.id}" requires a collection to iterate over. Please provide an array or object in the collection field.`
        )
      }

      forEachItems = await this.evaluateForEachItems(loop.forEachItems, context, block)
      logger.info(`Evaluated forEach items for loop ${block.id}:`, forEachItems)

      if (
        !forEachItems ||
        (Array.isArray(forEachItems) && forEachItems.length === 0) ||
        (typeof forEachItems === 'object' && Object.keys(forEachItems).length === 0)
      ) {
        throw new Error(
          `forEach loop "${block.id}" collection is empty or invalid. Please provide a non-empty array or object.`
        )
      }

      const itemsLength = Array.isArray(forEachItems)
        ? forEachItems.length
        : Object.keys(forEachItems).length

      maxIterations = itemsLength

      logger.info(
        `forEach loop ${block.id} - Items: ${itemsLength}, Max iterations: ${maxIterations}`
      )
    } else if (loop.loopType === 'while' || loop.loopType === 'doWhile') {
      // For while and doWhile loops, set loop context BEFORE evaluating condition
      // This makes variables like index, currentIteration available in the condition
      const loopContext = {
        index: currentIteration - 1, // 0-based index
        currentIteration, // 1-based iteration number
      }
      context.loopItems.set(block.id, loopContext)

      // Evaluate the condition to determine if we should continue
      if (!loop.whileCondition || loop.whileCondition.trim() === '') {
        throw new Error(
          `${loop.loopType} loop "${block.id}" requires a condition expression. Please provide a valid JavaScript expression.`
        )
      }

      // For doWhile loops, skip condition evaluation on the first iteration
      // For while loops, always evaluate the condition
      if (loop.loopType === 'doWhile' && currentIteration === 1) {
        shouldContinueLoop = true
      } else {
        // Evaluate the condition at the start of each iteration
        try {
          if (!this.resolver) {
            throw new Error('Resolver is required for while/doWhile loop condition evaluation')
          }
          shouldContinueLoop = await evaluateConditionExpression(
            loop.whileCondition,
            context,
            block,
            this.resolver
          )
        } catch (error: any) {
          throw new Error(
            `Failed to evaluate ${loop.loopType} loop condition for "${block.id}": ${error.message}`
          )
        }
      }

      // No max iterations for while/doWhile - rely on condition and workflow timeout
      maxIterations = Number.MAX_SAFE_INTEGER
    } else {
      maxIterations = loop.iterations || DEFAULT_MAX_ITERATIONS
      logger.info(`For loop ${block.id} - Max iterations: ${maxIterations}`)
    }

    logger.info(
      `Loop ${block.id} - Current iteration: ${currentIteration}, Max iterations: ${maxIterations}, Should continue: ${shouldContinueLoop}`
    )

    // For while and doWhile loops, check if the condition is false
    if ((loop.loopType === 'while' || loop.loopType === 'doWhile') && !shouldContinueLoop) {
      // Mark the loop as completed
      context.completedLoops.add(block.id)

      // Remove any activated loop-start paths since we're not continuing
      const loopStartConnections =
        context.workflow?.connections.filter(
          (conn) => conn.source === block.id && conn.sourceHandle === 'loop-start-source'
        ) || []

      for (const conn of loopStartConnections) {
        context.activeExecutionPath.delete(conn.target)
      }

      // Activate the loop-end connections (blocks after the loop)
      const loopEndConnections =
        context.workflow?.connections.filter(
          (conn) => conn.source === block.id && conn.sourceHandle === 'loop-end-source'
        ) || []

      for (const conn of loopEndConnections) {
        context.activeExecutionPath.add(conn.target)
      }

      return {
        loopId: block.id,
        currentIteration,
        maxIterations,
        loopType: loop.loopType,
        completed: true,
        message: `${loop.loopType === 'doWhile' ? 'Do-While' : 'While'} loop completed after ${currentIteration} iterations (condition became false)`,
      } as Record<string, any>
    }

    // Only check max iterations for for/forEach loops (while/doWhile have no limit)
    if (
      (loop.loopType === 'for' || loop.loopType === 'forEach') &&
      currentIteration > maxIterations
    ) {
      logger.info(`Loop ${block.id} has reached maximum iterations (${maxIterations})`)

      return {
        loopId: block.id,
        currentIteration: currentIteration - 1, // Report the actual last iteration number
        maxIterations,
        loopType: loop.loopType || 'for',
        completed: false, // Not completed until all blocks in this iteration execute
        message: `Final iteration ${currentIteration} of ${maxIterations}`,
      } as Record<string, any>
    }

    if (loop.loopType === 'forEach' && forEachItems) {
      context.loopItems.set(`${block.id}_items`, forEachItems)

      const arrayIndex = currentIteration - 1
      const currentItem = Array.isArray(forEachItems)
        ? forEachItems[arrayIndex]
        : Object.entries(forEachItems)[arrayIndex]
      context.loopItems.set(block.id, currentItem)
      logger.info(
        `Loop ${block.id} - Set current item for iteration ${currentIteration} (index ${arrayIndex}):`,
        currentItem
      )
    }

    // Use routing strategy to determine if this block requires active path checking
    const blockType = block.metadata?.id
    if (Routing.requiresActivePathCheck(blockType || '')) {
      let isInActivePath = true
      if (this.pathTracker) {
        try {
          isInActivePath = this.pathTracker.isInActivePath(block.id, context)
        } catch (error) {
          logger.warn(`PathTracker check failed for ${blockType} block ${block.id}:`, error)
          isInActivePath = true
        }
      }

      if (isInActivePath) {
        this.activateChildNodes(block, context, currentIteration)
      } else {
        logger.info(
          `${blockType} block ${block.id} is not in active execution path, skipping child activation`
        )
      }
    } else {
      this.activateChildNodes(block, context, currentIteration)
    }

    // For while/doWhile loops, now that condition is confirmed true, reset child blocks and increment counter
    if (loop.loopType === 'while' || loop.loopType === 'doWhile') {
      // Reset all child blocks for this iteration
      for (const nodeId of loop.nodes || []) {
        context.executedBlocks.delete(nodeId)
        context.blockStates.delete(nodeId)
        context.activeExecutionPath.delete(nodeId)
        context.decisions.router.delete(nodeId)
        context.decisions.condition.delete(nodeId)
      }

      // Increment the counter for the next iteration
      context.loopIterations.set(block.id, currentIteration + 1)
    } else {
      // For for/forEach loops, keep the counter value - it will be managed by the loop manager
      context.loopIterations.set(block.id, currentIteration)
    }

    return {
      loopId: block.id,
      currentIteration,
      maxIterations,
      loopType: loop.loopType || 'for',
      completed: false,
      message: `Starting iteration ${currentIteration} of ${maxIterations}`,
    } as Record<string, any>
  }

  /**
   * Activate child nodes for loop execution
   */
  private activateChildNodes(
    block: SerializedBlock,
    context: ExecutionContext,
    currentIteration: number
  ): void {
    const loopStartConnections =
      context.workflow?.connections.filter(
        (conn) => conn.source === block.id && conn.sourceHandle === 'loop-start-source'
      ) || []

    for (const conn of loopStartConnections) {
      context.activeExecutionPath.add(conn.target)
      logger.info(`Activated loop start path to ${conn.target} for iteration ${currentIteration}`)
    }
  }

  /**
   * Evaluates forEach items expression or value
   */
  private async evaluateForEachItems(
    forEachItems: any,
    context: ExecutionContext,
    block: SerializedBlock
  ): Promise<any[] | Record<string, any> | null> {
    // If already an array or object, return as-is
    if (
      Array.isArray(forEachItems) ||
      (typeof forEachItems === 'object' && forEachItems !== null)
    ) {
      return forEachItems
    }

    // If it's a string expression, try to evaluate it
    if (typeof forEachItems === 'string') {
      try {
        const trimmed = forEachItems.trim()
        if (trimmed.startsWith('//') || trimmed === '') {
          return []
        }

        // Try to parse as JSON first
        if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
          try {
            return JSON.parse(trimmed)
          } catch {
            // Continue to expression evaluation
          }
        }

        // If we have a resolver, use it to resolve any variable references first, then block references
        if (this.resolver) {
          const resolvedVars = this.resolver.resolveVariableReferences(forEachItems, block)
          const resolved = this.resolver.resolveBlockReferences(resolvedVars, context, block)

          // Try to parse the resolved value
          try {
            return JSON.parse(resolved)
          } catch {
            // If it's not valid JSON, try to evaluate as an expression
            try {
              const result = new Function(`return ${resolved}`)()
              if (Array.isArray(result) || (typeof result === 'object' && result !== null)) {
                return result
              }
            } catch (e) {
              logger.error(`Error evaluating forEach expression: ${resolved}`, e)
            }
          }
        }

        logger.warn(`forEach expression evaluation not fully implemented: ${forEachItems}`)
        return null
      } catch (error) {
        logger.error(`Error evaluating forEach items:`, error)
        return null
      }
    }

    return null
  }
}
