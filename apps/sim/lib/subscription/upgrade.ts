import { useCallback } from 'react'
import { client, useSession, useSubscription } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { useOrganizationStore } from '@/stores/organization'
import { useSubscriptionStore } from '@/stores/subscription/store'

const logger = createLogger('SubscriptionUpgrade')

type TargetPlan = 'pro' | 'team'

const CONSTANTS = {
  INITIAL_TEAM_SEATS: 1,
} as const

/**
 * Handles organization creation for team plans and proper referenceId management
 */
export function useSubscriptionUpgrade() {
  const { data: session } = useSession()
  const betterAuthSubscription = useSubscription()
  const { loadData: loadOrganizationData } = useOrganizationStore()

  const handleUpgrade = useCallback(
    async (targetPlan: TargetPlan) => {
      if (!session?.user?.id) {
        throw new Error('User not authenticated')
      }

      const { subscriptionData } = useSubscriptionStore.getState()
      const currentSubscriptionId = subscriptionData?.stripeSubscriptionId

      let referenceId = session.user.id

      // For team plans, create organization first and use its ID as referenceId
      if (targetPlan === 'team') {
        try {
          logger.info('Creating organization for team plan upgrade', {
            userId: session.user.id,
          })

          const response = await fetch('/api/organizations', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
          })

          if (!response.ok) {
            throw new Error(`Failed to create organization: ${response.statusText}`)
          }

          const result = await response.json()

          logger.info('Organization API response', {
            result,
            success: result.success,
            organizationId: result.organizationId,
          })

          if (!result.success || !result.organizationId) {
            throw new Error('Failed to create organization for team plan')
          }

          referenceId = result.organizationId

          // Set the organization as active so Better Auth recognizes it
          try {
            await client.organization.setActive({ organizationId: result.organizationId })

            logger.info('Set organization as active and updated referenceId', {
              organizationId: result.organizationId,
              oldReferenceId: session.user.id,
              newReferenceId: referenceId,
            })
          } catch (error) {
            logger.warn('Failed to set organization as active, but proceeding with upgrade', {
              organizationId: result.organizationId,
              error: error instanceof Error ? error.message : 'Unknown error',
            })
            // Continue with upgrade even if setting active fails
          }
        } catch (error) {
          logger.error('Failed to create organization for team plan', error)
          throw new Error('Failed to create team workspace. Please try again or contact support.')
        }
      }

      const currentUrl = `${window.location.origin}${window.location.pathname}`

      try {
        const upgradeParams = {
          plan: targetPlan,
          referenceId,
          successUrl: currentUrl,
          cancelUrl: currentUrl,
          ...(targetPlan === 'team' && { seats: CONSTANTS.INITIAL_TEAM_SEATS }),
        } as const

        // Add subscriptionId for existing subscriptions to ensure proper plan switching
        const finalParams = currentSubscriptionId
          ? { ...upgradeParams, subscriptionId: currentSubscriptionId }
          : upgradeParams

        logger.info(
          currentSubscriptionId ? 'Upgrading existing subscription' : 'Creating new subscription',
          {
            targetPlan,
            currentSubscriptionId,
            referenceId,
          }
        )

        await betterAuthSubscription.upgrade(finalParams)

        // For team plans, refresh organization data to ensure UI updates
        if (targetPlan === 'team') {
          try {
            await loadOrganizationData()
            logger.info('Refreshed organization data after team upgrade')
          } catch (error) {
            logger.warn('Failed to refresh organization data after upgrade', error)
            // Don't fail the entire upgrade if data refresh fails
          }
        }

        logger.info('Subscription upgrade completed successfully', {
          targetPlan,
          referenceId,
        })
      } catch (error) {
        logger.error('Failed to initiate subscription upgrade:', error)

        // Log detailed error information for debugging
        if (error instanceof Error) {
          console.error('Detailed error:', {
            message: error.message,
            stack: error.stack,
            cause: error.cause,
          })
        }

        throw new Error(
          `Failed to upgrade subscription: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      }
    },
    [session?.user?.id, betterAuthSubscription, loadOrganizationData]
  )

  return { handleUpgrade }
}
