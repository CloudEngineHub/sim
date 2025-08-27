import { createLogger } from '@/lib/logs/console/logger'
import type { ChatContext } from '@/stores/copilot/types'
import { db } from '@/db'
import { copilotChats } from '@/db/schema'
import { and, eq } from 'drizzle-orm'

export type AgentContextType = 'past_chat' | 'workflow' | 'blocks' | 'logs' | 'knowledge' | 'templates'

export interface AgentContext {
  type: AgentContextType
  content: string
}

const logger = createLogger('ProcessContents')

export async function processContexts(contexts: ChatContext[] | undefined): Promise<AgentContext[]> {
  if (!Array.isArray(contexts) || contexts.length === 0) return []
  const results: AgentContext[] = []

  for (const ctx of contexts) {
    try {
      if (ctx.kind === 'past_chat') {
        const processed = await processPastChatViaApi(ctx.chatId)
        if (processed) results.push(processed)
      }
      // Other kinds can be added here: workflow, blocks, logs, knowledge, templates
    } catch (error) {
      logger.error('Failed processing context', { ctx, error })
    }
  }

  return results
}

// Server-side variant (recommended for use in API routes)
export async function processContextsServer(
  contexts: ChatContext[] | undefined,
  userId: string
): Promise<AgentContext[]> {
  if (!Array.isArray(contexts) || contexts.length === 0) return []
  const results: AgentContext[] = []
  for (const ctx of contexts) {
    try {
      if (ctx.kind === 'past_chat' && ctx.chatId) {
        const processed = await processPastChatFromDb(ctx.chatId, userId)
        if (processed) results.push(processed)
      }
    } catch (error) {
      logger.error('Failed processing context (server)', { ctx, error })
    }
  }
  return results
}

async function processPastChatFromDb(chatId: string, userId: string): Promise<AgentContext | null> {
  try {
    const rows = await db
      .select({ messages: copilotChats.messages })
      .from(copilotChats)
      .where(and(eq(copilotChats.id, chatId), eq(copilotChats.userId, userId)))
      .limit(1)
    const messages = Array.isArray(rows?.[0]?.messages) ? (rows[0] as any).messages : []
    const content = messages
      .map((m: any) => {
        const role = m.role || 'user'
        let text = ''
        if (Array.isArray(m.contentBlocks) && m.contentBlocks.length > 0) {
          text = m.contentBlocks
            .filter((b: any) => b?.type === 'text')
            .map((b: any) => String(b.content || ''))
            .join('')
            .trim()
        }
        if (!text && typeof m.content === 'string') text = m.content
        return `${role}: ${text}`.trim()
      })
      .filter((s: string) => s.length > 0)
      .join('\n')
    return { type: 'past_chat', content }
  } catch (error) {
    logger.error('Error processing past chat from db', { chatId, error })
    return null
  }
}

async function processPastChat(chatId: string): Promise<AgentContext | null> {
  try {
    const resp = await fetch(`/api/copilot/chat/${encodeURIComponent(chatId)}`)
    if (!resp.ok) {
      logger.error('Failed to fetch past chat', { chatId, status: resp.status })
      return null
    }
    const data = await resp.json()
    const messages = Array.isArray(data?.chat?.messages) ? data.chat.messages : []
    const content = messages
      .map((m: any) => {
        const role = m.role || 'user'
        // Prefer contentBlocks text if present (joins text blocks), else use content
        let text = ''
        if (Array.isArray(m.contentBlocks) && m.contentBlocks.length > 0) {
          text = m.contentBlocks
            .filter((b: any) => b?.type === 'text')
            .map((b: any) => String(b.content || ''))
            .join('')
            .trim()
        }
        if (!text && typeof m.content === 'string') text = m.content
        return `${role}: ${text}`.trim()
      })
      .filter((s: string) => s.length > 0)
      .join('\n')

    return { type: 'past_chat', content }
  } catch (error) {
    logger.error('Error processing past chat', { chatId, error })
    return null
  }
}

// Back-compat alias; used by processContexts above
async function processPastChatViaApi(chatId: string) {
  return processPastChat(chatId)
} 