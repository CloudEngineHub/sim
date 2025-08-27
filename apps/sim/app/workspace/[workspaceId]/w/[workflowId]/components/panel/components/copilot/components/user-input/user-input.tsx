'use client'

import {
  forwardRef,
  type KeyboardEvent,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import {
  ArrowUp,
  Brain,
  BrainCircuit,
  Check,
  FileText,
  Image,
  Infinity as InfinityIcon,
  Info,
  ChevronRight,
  Loader2,
  MessageCircle,
  Package,
  Paperclip,
  X,
  Zap,
} from 'lucide-react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Switch,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui'
import { Input } from '@/components/ui'
import { useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { CopilotSlider } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/components/copilot-slider'
import { useCopilotStore } from '@/stores/copilot/store'
import type { ChatContext } from '@/stores/copilot/types'

const logger = createLogger('CopilotUserInput')

export interface MessageFileAttachment {
  id: string
  key: string
  filename: string
  media_type: string
  size: number
}

interface AttachedFile {
  id: string
  name: string
  size: number
  type: string
  path: string
  key?: string // Add key field to store the actual storage key
  uploading: boolean
  previewUrl?: string // For local preview of images before upload
}

interface UserInputProps {
  onSubmit: (message: string, fileAttachments?: MessageFileAttachment[], contexts?: ChatContext[]) => void
  onAbort?: () => void
  disabled?: boolean
  isLoading?: boolean
  isAborting?: boolean
  placeholder?: string
  className?: string
  mode?: 'ask' | 'agent'
  onModeChange?: (mode: 'ask' | 'agent') => void
  value?: string // Controlled value from outside
  onChange?: (value: string) => void // Callback when value changes
}

interface UserInputRef {
  focus: () => void
}

const UserInput = forwardRef<UserInputRef, UserInputProps>(
  (
    {
      onSubmit,
      onAbort,
      disabled = false,
      isLoading = false,
      isAborting = false,
      placeholder = 'How can I help you today?',
      className,
      mode = 'agent',
      onModeChange,
      value: controlledValue,
      onChange: onControlledChange,
    },
    ref
  ) => {
    const [internalMessage, setInternalMessage] = useState('')
    const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
    // Drag and drop state
    const [isDragging, setIsDragging] = useState(false)
    const [dragCounter, setDragCounter] = useState(0)
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const [showMentionMenu, setShowMentionMenu] = useState(false)
    const mentionMenuRef = useRef<HTMLDivElement>(null)
    const submenuRef = useRef<HTMLDivElement>(null)
    const [mentionActiveIndex, setMentionActiveIndex] = useState(0)
    const mentionOptions = ['Past Chat', 'Workflow', 'Blocks', 'Logs', 'Knowledge', 'Templates']
    const [openSubmenuFor, setOpenSubmenuFor] = useState<string | null>(null)
    const [submenuActiveIndex, setSubmenuActiveIndex] = useState(0)
    const [pastChats, setPastChats] = useState<Array<{ id: string; title: string | null; workflowId: string | null; updatedAt?: string }>>([])
    const [isLoadingPastChats, setIsLoadingPastChats] = useState(false)
    const [pastChatsQuery, setPastChatsQuery] = useState('')
    const [selectedContexts, setSelectedContexts] = useState<ChatContext[]>([])
    const [workflows, setWorkflows] = useState<Array<{ id: string; name: string }>>([])
    const [isLoadingWorkflows, setIsLoadingWorkflows] = useState(false)
    const [workflowsQuery, setWorkflowsQuery] = useState('')

    const { data: session } = useSession()
    const { currentChat, workflowId } = useCopilotStore()

    // Expose focus method to parent
    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          textareaRef.current?.focus()
        },
      }),
      []
    )

    // Use controlled value if provided, otherwise use internal state
    const message = controlledValue !== undefined ? controlledValue : internalMessage
    const setMessage =
      controlledValue !== undefined ? onControlledChange || (() => {}) : setInternalMessage

    // Auto-resize textarea and toggle vertical scroll when exceeding max height
    useEffect(() => {
      const textarea = textareaRef.current
      if (textarea) {
        const maxHeight = 120
        textarea.style.height = 'auto'
        const nextHeight = Math.min(textarea.scrollHeight, maxHeight)
        textarea.style.height = `${nextHeight}px`
        textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden'
      }
    }, [message])

    // Close mention menu on outside click
    useEffect(() => {
      if (!showMentionMenu) return
      const handleClickOutside = (e: MouseEvent) => {
        const target = e.target as Node | null
        if (
          mentionMenuRef.current &&
          !mentionMenuRef.current.contains(target) &&
          (!submenuRef.current || !submenuRef.current.contains(target)) &&
          textareaRef.current &&
          !textareaRef.current.contains(target as Node)
        ) {
          setShowMentionMenu(false)
          setOpenSubmenuFor(null)
        }
      }
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [showMentionMenu])

    const ensurePastChatsLoaded = async () => {
      if (isLoadingPastChats || pastChats.length > 0) return
      try {
        setIsLoadingPastChats(true)
        const resp = await fetch('/api/copilot/chats')
        if (!resp.ok) throw new Error(`Failed to load chats: ${resp.status}`)
        const data = await resp.json()
        const items = Array.isArray(data?.chats) ? data.chats : []
        setPastChats(
          items.map((c: any) => ({
            id: c.id,
            title: c.title ?? null,
            workflowId: c.workflowId ?? null,
            updatedAt: c.updatedAt,
          }))
        )
      } catch {
      } finally {
        setIsLoadingPastChats(false)
      }
    }

    const ensureWorkflowsLoaded = async () => {
      if (isLoadingWorkflows || workflows.length > 0) return
      try {
        setIsLoadingWorkflows(true)
        const resp = await fetch('/api/workflows/sync')
        if (!resp.ok) throw new Error(`Failed to load workflows: ${resp.status}`)
        const data = await resp.json()
        const items = Array.isArray(data?.data) ? data.data : []
        setWorkflows(items.map((w: any) => ({ id: w.id, name: w.name || 'Untitled Workflow' })))
      } catch {}
      finally {
        setIsLoadingWorkflows(false)
      }
    }

    // Cleanup preview URLs on unmount
    useEffect(() => {
      return () => {
        attachedFiles.forEach((f) => {
          if (f.previewUrl) {
            URL.revokeObjectURL(f.previewUrl)
          }
        })
      }
    }, [])

    // Drag and drop handlers
    const handleDragEnter = (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDragCounter((prev) => {
        const newCount = prev + 1
        if (newCount === 1) {
          setIsDragging(true)
        }
        return newCount
      })
    }

    const handleDragLeave = (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDragCounter((prev) => {
        const newCount = prev - 1
        if (newCount === 0) {
          setIsDragging(false)
        }
        return newCount
      })
    }

    const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      // Add visual feedback for valid drop zone
      e.dataTransfer.dropEffect = 'copy'
    }

    const handleDrop = async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)
      setDragCounter(0)

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        await processFiles(e.dataTransfer.files)
      }
    }

    // Process dropped or selected files
    const processFiles = async (fileList: FileList) => {
      const userId = session?.user?.id

      if (!userId) {
        logger.error('User ID not available for file upload')
        return
      }

      // Process files one by one
      for (const file of Array.from(fileList)) {
        // Create a preview URL for images
        let previewUrl: string | undefined
        if (file.type.startsWith('image/')) {
          previewUrl = URL.createObjectURL(file)
        }

        // Create a temporary file entry with uploading state
        const tempFile: AttachedFile = {
          id: crypto.randomUUID(),
          name: file.name,
          size: file.size,
          type: file.type,
          path: '',
          uploading: true,
          previewUrl,
        }

        setAttachedFiles((prev) => [...prev, tempFile])

        try {
          // Request presigned URL
          const presignedResponse = await fetch('/api/files/presigned?type=copilot', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              fileName: file.name,
              contentType: file.type,
              fileSize: file.size,
              userId,
            }),
          })

          if (!presignedResponse.ok) {
            throw new Error('Failed to get presigned URL')
          }

          const presignedData = await presignedResponse.json()

          logger.info(`Uploading file: ${presignedData.presignedUrl}`)
          const uploadHeaders = presignedData.uploadHeaders || {}
          const uploadResponse = await fetch(presignedData.presignedUrl, {
            method: 'PUT',
            headers: {
              'Content-Type': file.type,
              ...uploadHeaders,
            },
            body: file,
          })

          logger.info(`Upload response status: ${uploadResponse.status}`)

          if (!uploadResponse.ok) {
            const errorText = await uploadResponse.text()
            logger.error(`Upload failed: ${errorText}`)
            throw new Error(`Failed to upload file: ${uploadResponse.status} ${errorText}`)
          }

          // Update file entry with success
          setAttachedFiles((prev) =>
            prev.map((f) =>
              f.id === tempFile.id
                ? {
                    ...f,
                    path: presignedData.fileInfo.path,
                    key: presignedData.fileInfo.key, // Store the actual storage key
                    uploading: false,
                  }
                : f
            )
          )
        } catch (error) {
          logger.error(`File upload failed: ${error}`)
          // Remove failed upload
          setAttachedFiles((prev) => prev.filter((f) => f.id !== tempFile.id))
        }
      }
    }

    const handleSubmit = () => {
      const trimmedMessage = message.trim()
      if (!trimmedMessage || disabled || isLoading) return

      // Check for failed uploads and show user feedback
      const failedUploads = attachedFiles.filter((f) => !f.uploading && !f.key)
      if (failedUploads.length > 0) {
        logger.error(`Some files failed to upload: ${failedUploads.map((f) => f.name).join(', ')}`)
      }

      // Convert attached files to the format expected by the API
      const fileAttachments = attachedFiles
        .filter((f) => !f.uploading && f.key) // Only include successfully uploaded files with keys
        .map((f) => ({
          id: f.id,
          key: f.key!, // Use the actual storage key from the upload response
          filename: f.name,
          media_type: f.type,
          size: f.size,
        }))

      onSubmit(trimmedMessage, fileAttachments, selectedContexts)

      // Clean up preview URLs before clearing
      attachedFiles.forEach((f) => {
        if (f.previewUrl) {
          URL.revokeObjectURL(f.previewUrl)
        }
      })

      // Clear the message and files after submit
      if (controlledValue !== undefined) {
        onControlledChange?.('')
      } else {
        setInternalMessage('')
      }
      setAttachedFiles([])
      setSelectedContexts([])
      setOpenSubmenuFor(null)
      setShowMentionMenu(false)
    }

    const handleAbort = () => {
      if (onAbort && isLoading) {
        onAbort()
      }
    }

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape' && showMentionMenu) {
        setShowMentionMenu(false)
        setOpenSubmenuFor(null)
        return
      }
      if (showMentionMenu && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault()
        if (openSubmenuFor === 'Past Chat' && pastChats.length > 0) {
          setSubmenuActiveIndex((prev) => {
            const last = pastChats.length - 1
            if (e.key === 'ArrowDown') return prev >= last ? 0 : prev + 1
            return prev <= 0 ? last : prev - 1
          })
        } else if (openSubmenuFor === 'Workflow' && workflows.length > 0) {
          setSubmenuActiveIndex((prev) => {
            const last = workflows.length - 1
            if (e.key === 'ArrowDown') return prev >= last ? 0 : prev + 1
            return prev <= 0 ? last : prev - 1
          })
        } else {
          setMentionActiveIndex((prev) => {
            const last = mentionOptions.length - 1
            if (e.key === 'ArrowDown') return prev >= last ? 0 : prev + 1
            return prev <= 0 ? last : prev - 1
          })
        }
        return
      }
      if (showMentionMenu && e.key === 'ArrowRight') {
        e.preventDefault()
        const selected = mentionOptions[mentionActiveIndex]
        if (selected === 'Past Chat') {
          setOpenSubmenuFor('Past Chat')
          setSubmenuActiveIndex(0)
          void ensurePastChatsLoaded()
        } else if (selected === 'Workflow') {
          setOpenSubmenuFor('Workflow')
          setSubmenuActiveIndex(0)
          void ensureWorkflowsLoaded()
        }
        return
      }
      if (showMentionMenu && e.key === 'ArrowLeft') {
        if (openSubmenuFor) {
          e.preventDefault()
          setOpenSubmenuFor(null)
          return
        }
      }

      // Mention token behavior (outside of menus)
      const textarea = textareaRef.current
      const selStart = textarea?.selectionStart ?? 0
      const selEnd = textarea?.selectionEnd ?? selStart
      const selectionLength = Math.abs(selEnd - selStart)

      // Backspace: delete entire token if cursor is inside or right after token
      if (!showMentionMenu && e.key === 'Backspace') {
        const pos = selStart
        const ranges = computeMentionRanges()
        // If there is a selection intersecting a token, delete those tokens
        const target =
          selectionLength > 0
            ? ranges.find((r) => !(selEnd <= r.start || selStart >= r.end))
            : ranges.find((r) => pos > r.start && pos <= r.end)
        if (target) {
          e.preventDefault()
          deleteRange(target)
          return
        }
      }

      // Delete: if at start of token, delete whole token
      if (!showMentionMenu && e.key === 'Delete') {
        const pos = selStart
        const ranges = computeMentionRanges()
        const target = ranges.find((r) => pos >= r.start && pos < r.end)
        if (target) {
          e.preventDefault()
          deleteRange(target)
          return
        }
      }

      // Prevent typing inside token
      if (!showMentionMenu && (e.key.length === 1 || e.key === 'Space')) {
        const pos = selStart
        const ranges = computeMentionRanges()
        // If any selection overlaps a token, block
        const blocked =
          (selectionLength > 0 && ranges.some((r) => !(selEnd <= r.start || selStart >= r.end))) ||
          (!!findRangeContaining(pos) && !!findRangeContaining(pos)?.label)
        if (blocked) {
          e.preventDefault()
          // Move caret to end of the token
          const r = findRangeContaining(pos)
          if (r && textarea) {
            requestAnimationFrame(() => {
              textarea.setSelectionRange(r.end, r.end)
            })
          }
          return
        }
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (!showMentionMenu) {
          handleSubmit()
        } else {
          const selected = mentionOptions[mentionActiveIndex]
          if (!openSubmenuFor && selected === 'Past Chat') {
            setOpenSubmenuFor('Past Chat')
            setSubmenuActiveIndex(0)
            void ensurePastChatsLoaded()
          } else if (openSubmenuFor === 'Past Chat') {
            const filtered = pastChats.filter((c) =>
              (c.title || 'Untitled Chat').toLowerCase().includes(pastChatsQuery.toLowerCase())
            )
            if (filtered.length > 0) {
              const chosen = filtered[Math.max(0, Math.min(submenuActiveIndex, filtered.length - 1))]
              insertPastChatMention(chosen)
            }
          } else if (!openSubmenuFor && selected === 'Workflow') {
            setOpenSubmenuFor('Workflow')
            setSubmenuActiveIndex(0)
            void ensureWorkflowsLoaded()
          } else if (openSubmenuFor === 'Workflow') {
            const filtered = workflows.filter((w) =>
              (w.name || 'Untitled Workflow').toLowerCase().includes(workflowsQuery.toLowerCase())
            )
            if (filtered.length > 0) {
              const chosen = filtered[Math.max(0, Math.min(submenuActiveIndex, filtered.length - 1))]
              insertWorkflowMention(chosen)
            }
          }
        }
      }
    }

    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value
      if (controlledValue !== undefined) {
        onControlledChange?.(newValue)
      } else {
        setInternalMessage(newValue)
      }
      if (newValue.endsWith('@')) {
        setMentionActiveIndex(0)
        setShowMentionMenu(true)
        setOpenSubmenuFor(null)
      } else if (showMentionMenu) {
        setShowMentionMenu(false)
        setOpenSubmenuFor(null)
      }
    }

    const handleSelectAdjust = () => {
      const textarea = textareaRef.current
      if (!textarea) return
      const pos = textarea.selectionStart ?? 0
      const r = findRangeContaining(pos)
      if (r) {
        // Snap caret to token boundary to avoid typing inside
        const snapPos = pos - r.start < r.end - pos ? r.start : r.end
        requestAnimationFrame(() => {
          textarea.setSelectionRange(snapPos, snapPos)
        })
      }
    }

    const insertAtCursor = (text: string) => {
      const textarea = textareaRef.current
      if (!textarea) return
      const start = textarea.selectionStart ?? message.length
      const end = textarea.selectionEnd ?? message.length
      let before = message.slice(0, start)
      const after = message.slice(end)
      // Avoid duplicate '@' if user typed trigger
      if (before.endsWith('@') && text.startsWith('@')) {
        before = before.slice(0, -1)
      }
      const next = `${before}${text}${after}`
      if (controlledValue !== undefined) {
        onControlledChange?.(next)
      } else {
        setInternalMessage(next)
      }
      // Move cursor to after inserted text
      setTimeout(() => {
        const pos = before.length + text.length
        textarea.setSelectionRange(pos, pos)
        textarea.focus()
      }, 0)
    }

    const insertPastChatMention = (chat: { id: string; title: string | null }) => {
      const label = chat.title || 'Untitled Chat'
      const token = `@${label}`
      insertAtCursor(`${token} `)
      setSelectedContexts((prev) => {
        // Avoid duplicate contexts for same chat
        if (prev.some((c) => c.kind === 'past_chat' && (c as any).chatId === chat.id)) return prev
        return [...prev, { kind: 'past_chat', chatId: chat.id, label } as ChatContext]
      })
      setShowMentionMenu(false)
      setOpenSubmenuFor(null)
    }

    const insertWorkflowMention = (wf: { id: string; name: string }) => {
      const label = wf.name || 'Untitled Workflow'
      const token = `@${label}`
      insertAtCursor(`${token} `)
      setSelectedContexts((prev) => {
        if (prev.some((c) => c.kind === 'workflow' && (c as any).workflowId === wf.id)) return prev
        return [...prev, { kind: 'workflow', workflowId: wf.id, label } as ChatContext]
      })
      setShowMentionMenu(false)
      setOpenSubmenuFor(null)
    }

    const handleFileSelect = () => {
      if (disabled || isLoading) {
        return
      }

      fileInputRef.current?.click()
    }

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (!files || files.length === 0) {
        return
      }

      await processFiles(files)

      // Clear the input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }

    const removeFile = (fileId: string) => {
      // Clean up preview URL if it exists
      const file = attachedFiles.find((f) => f.id === fileId)
      if (file?.previewUrl) {
        URL.revokeObjectURL(file.previewUrl)
      }
      setAttachedFiles((prev) => prev.filter((f) => f.id !== fileId))
    }

    const handleFileClick = (file: AttachedFile) => {
      // If file has been uploaded and has a storage key, open the file URL
      if (file.key) {
        const serveUrl = file.path
        window.open(serveUrl, '_blank')
      } else if (file.previewUrl) {
        // If file hasn't been uploaded yet but has a preview URL, open that
        window.open(file.previewUrl, '_blank')
      }
    }

    const formatFileSize = (bytes: number) => {
      if (bytes === 0) return '0 Bytes'
      const k = 1024
      const sizes = ['Bytes', 'KB', 'MB', 'GB']
      const i = Math.floor(Math.log(bytes) / Math.log(k))
      return `${Math.round((bytes / k ** i) * 100) / 100} ${sizes[i]}`
    }

    const isImageFile = (type: string) => {
      return type.startsWith('image/')
    }

    const getFileIcon = (mediaType: string) => {
      if (mediaType.startsWith('image/')) {
        return <Image className='h-5 w-5 text-muted-foreground' />
      }
      if (mediaType.includes('pdf')) {
        return <FileText className='h-5 w-5 text-red-500' />
      }
      if (mediaType.includes('text') || mediaType.includes('json') || mediaType.includes('xml')) {
        return <FileText className='h-5 w-5 text-blue-500' />
      }
      return <FileText className='h-5 w-5 text-muted-foreground' />
    }

    // Mention token utilities
    const computeMentionRanges = () => {
      const ranges: Array<{ start: number; end: number; label: string }> = []
      if (!message || selectedContexts.length === 0) return ranges
      // Build labels map for quick search
      const labels = selectedContexts.map((c) => c.label).filter(Boolean)
      if (labels.length === 0) return ranges
      // For each label, find all occurrences of @label (case-sensitive)
      for (const label of labels) {
        const token = `@${label}`
        let fromIndex = 0
        while (fromIndex <= message.length) {
          const idx = message.indexOf(token, fromIndex)
          if (idx === -1) break
          ranges.push({ start: idx, end: idx + token.length, label })
          fromIndex = idx + token.length
        }
      }
      // Sort by start
      ranges.sort((a, b) => a.start - b.start)
      return ranges
    }

    const findRangeContaining = (pos: number) => {
      const ranges = computeMentionRanges()
      return ranges.find((r) => pos >= r.start && pos <= r.end)
    }

    const deleteRange = (range: { start: number; end: number; label: string }) => {
      const before = message.slice(0, range.start)
      const after = message.slice(range.end)
      const next = `${before}${after}`.replace(/\s{2,}/g, ' ')
      if (controlledValue !== undefined) {
        onControlledChange?.(next)
      } else {
        setInternalMessage(next)
      }
      // Remove corresponding context by label
      setSelectedContexts((prev) => prev.filter((c) => c.label !== range.label))
      // Place cursor at range.start
      requestAnimationFrame(() => {
        const textarea = textareaRef.current
        if (textarea) {
          textarea.setSelectionRange(range.start, range.start)
          textarea.focus()
        }
      })
    }

    const canSubmit = message.trim().length > 0 && !disabled && !isLoading
    const showAbortButton = isLoading && onAbort

    const handleModeToggle = () => {
      if (onModeChange) {
        // Toggle between Ask and Agent
        onModeChange(mode === 'ask' ? 'agent' : 'ask')
      }
    }

    const getModeIcon = () => {
      if (mode === 'ask') {
        return <MessageCircle className='h-3 w-3 text-muted-foreground' />
      }
      return <Package className='h-3 w-3 text-muted-foreground' />
    }

    const getModeText = () => {
      if (mode === 'ask') {
        return 'Ask'
      }
      return 'Agent'
    }

    // Depth toggle state comes from global store; access via useCopilotStore
    const { agentDepth, agentPrefetch, setAgentDepth, setAgentPrefetch } = useCopilotStore()

    // Ensure MAX mode is off for Fast and Balanced depths
    useEffect(() => {
      if (agentDepth < 2 && !agentPrefetch) {
        setAgentPrefetch(true)
      }
    }, [agentDepth, agentPrefetch, setAgentPrefetch])

    const cycleDepth = () => {
      // 8 modes: depths 0-3, each with prefetch off/on. Cycle depth, then toggle prefetch when wrapping.
      const nextDepth = agentDepth === 3 ? 0 : ((agentDepth + 1) as 0 | 1 | 2 | 3)
      if (nextDepth === 0 && agentDepth === 3) {
        setAgentPrefetch(!agentPrefetch)
      }
      setAgentDepth(nextDepth)
    }

    const getCollapsedModeLabel = () => {
      const base = getDepthLabelFor(agentDepth)
      return !agentPrefetch ? `${base} MAX` : base
    }

    const getDepthLabelFor = (value: 0 | 1 | 2 | 3) => {
      return value === 0 ? 'Fast' : value === 1 ? 'Balanced' : value === 2 ? 'Advanced' : 'Behemoth'
    }

    // Removed descriptive suffixes; concise labels only
    const getDepthDescription = (value: 0 | 1 | 2 | 3) => {
      if (value === 0)
        return 'Fastest and cheapest. Good for small edits, simple workflows, and small tasks'
      if (value === 1) return 'Balances speed and reasoning. Good fit for most tasks'
      if (value === 2)
        return 'More reasoning for larger workflows and complex edits, still balanced for speed'
      return 'Maximum reasoning power. Best for complex workflow building and debugging'
    }

    const getDepthIconFor = (value: 0 | 1 | 2 | 3) => {
      const colorClass = !agentPrefetch
        ? 'text-[var(--brand-primary-hover-hex)]'
        : 'text-muted-foreground'
      if (value === 0) return <Zap className={`h-3 w-3 ${colorClass}`} />
      if (value === 1) return <InfinityIcon className={`h-3 w-3 ${colorClass}`} />
      if (value === 2) return <Brain className={`h-3 w-3 ${colorClass}`} />
      return <BrainCircuit className={`h-3 w-3 ${colorClass}`} />
    }

    const getDepthIcon = () => getDepthIconFor(agentDepth)

    return (
      <div className={cn('relative flex-none pb-4', className)}>
        <div
          className={cn(
            'rounded-[8px] border border-[#E5E5E5] bg-[#FFFFFF] p-2 shadow-xs transition-all duration-200 dark:border-[#414141] dark:bg-[var(--surface-elevated)]',
            isDragging &&
              'border-[var(--brand-primary-hover-hex)] bg-purple-50/50 dark:border-[var(--brand-primary-hover-hex)] dark:bg-purple-950/20'
          )}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {/* Attached Files Display with Thumbnails */}
          {attachedFiles.length > 0 && (
            <div className='mb-2 flex flex-wrap gap-1.5'>
              {attachedFiles.map((file) => (
                <div
                  key={file.id}
                  className='group relative h-16 w-16 cursor-pointer overflow-hidden rounded-md border border-border/50 bg-muted/20 transition-all hover:bg-muted/40'
                  title={`${file.name} (${formatFileSize(file.size)})`}
                  onClick={() => handleFileClick(file)}
                >
                  {isImageFile(file.type) && file.previewUrl ? (
                    // For images, show actual thumbnail
                    <img
                      src={file.previewUrl}
                      alt={file.name}
                      className='h-full w-full object-cover'
                    />
                  ) : isImageFile(file.type) && file.key ? (
                    // For uploaded images without preview URL, use storage URL
                    <img
                      src={file.previewUrl || file.path}
                      alt={file.name}
                      className='h-full w-full object-cover'
                    />
                  ) : (
                    // For other files, show icon centered
                    <div className='flex h-full w-full items-center justify-center bg-background/50'>
                      {getFileIcon(file.type)}
                    </div>
                  )}

                  {/* Loading overlay */}
                  {file.uploading && (
                    <div className='absolute inset-0 flex items-center justify-center bg-black/50'>
                      <Loader2 className='h-4 w-4 animate-spin text-white' />
                    </div>
                  )}

                  {/* Remove button */}
                  {!file.uploading && (
                    <Button
                      variant='ghost'
                      size='icon'
                      onClick={(e) => {
                        e.stopPropagation()
                        removeFile(file.id)
                      }}
                      className='absolute top-0.5 right-0.5 h-5 w-5 bg-black/50 text-white opacity-0 transition-opacity hover:bg-black/70 group-hover:opacity-100'
                    >
                      <X className='h-3 w-3' />
                    </Button>
                  )}

                  {/* Hover overlay effect */}
                  <div className='pointer-events-none absolute inset-0 bg-black/10 opacity-0 transition-opacity group-hover:opacity-100' />
                </div>
              ))}
            </div>
          )}

          {/* Textarea Field */}
          <div className='relative'>
            {/* Highlight overlay */}
            <div className='pointer-events-none absolute inset-0 z-[1] px-[2px] py-1'>
              <pre className='whitespace-pre-wrap font-sans text-sm leading-[1.25rem] text-foreground'>
                {(() => {
                  const elements: React.ReactNode[] = []
                  let remaining = message
                  const contexts = selectedContexts
                  if (contexts.length === 0 || !remaining) return remaining
                  // Build regex for all labels
                  const labels = contexts.map((c) => c.label).filter(Boolean)
                  const pattern = new RegExp(
                    `@(${labels.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
                    'g'
                  )
                  let lastIndex = 0
                  let match: RegExpExecArray | null
                  while ((match = pattern.exec(remaining)) !== null) {
                    const i = match.index
                    const before = remaining.slice(lastIndex, i)
                    if (before) elements.push(before)
                    const mentionText = match[0]
                    elements.push(
                      <span key={`${mentionText}-${i}-${lastIndex}`} className='rounded-[6px] bg-muted'>
                        {mentionText}
                      </span>
                    )
                    lastIndex = i + mentionText.length
                  }
                  const tail = remaining.slice(lastIndex)
                  if (tail) elements.push(tail)
                  return elements
                })()}
              </pre>
            </div>
            <Textarea
              ref={textareaRef}
              value={message}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onSelect={handleSelectAdjust}
              onMouseUp={handleSelectAdjust}
              placeholder={isDragging ? 'Drop files here...' : placeholder}
              disabled={disabled}
              rows={1}
              className='relative z-[2] mb-2 min-h-[32px] w-full resize-none overflow-y-auto overflow-x-hidden border-0 bg-transparent px-[2px] py-1 text-transparent caret-foreground focus-visible:ring-0 focus-visible:ring-offset-0 font-sans text-sm leading-[1.25rem]'
              style={{ height: 'auto' }}
            />
            {showMentionMenu && (
              <>
                <div
                  ref={mentionMenuRef}
                  className='absolute left-0 bottom-full z-50 mb-1 w-56 rounded-[8px] border bg-popover p-1 text-foreground shadow-md max-h-64 overflow-auto'
                >
                  {mentionOptions.map((label, idx) => (
                    <div
                      key={label}
                      className={cn(
                        'flex items-center justify-between gap-2 cursor-default rounded-[6px] px-2 py-1.5 text-sm hover:bg-muted/60',
                        mentionActiveIndex === idx && 'bg-muted'
                      )}
                      role='menuitem'
                      aria-selected={mentionActiveIndex === idx}
                      onMouseEnter={() => setMentionActiveIndex(idx)}
                      onClick={() => {
                        if (label === 'Past Chat') {
                          setOpenSubmenuFor('Past Chat')
                          setSubmenuActiveIndex(0)
                          void ensurePastChatsLoaded()
                        } else if (label === 'Workflow') {
                          setOpenSubmenuFor('Workflow')
                          setSubmenuActiveIndex(0)
                          void ensureWorkflowsLoaded()
                        }
                      }}
                    >
                      <span>{label}</span>
                      <ChevronRight className='h-3.5 w-3.5 text-muted-foreground' />
                    </div>
                  ))}
                </div>

                {openSubmenuFor === 'Past Chat' && (
                  <div
                    ref={submenuRef}
                    className='absolute bottom-full z-50 mb-1 left-[calc(14rem+4px)] w-72 rounded-[8px] border bg-popover p-1 text-foreground shadow-md max-h-64 overflow-auto'
                  >
                    <div className='px-2 py-1.5 text-muted-foreground text-xs'>Past Chats</div>
                    <div className='px-2 pb-1'>
                      <Input
                        value={pastChatsQuery}
                        onChange={(e) => {
                          setPastChatsQuery(e.target.value)
                          setSubmenuActiveIndex(0)
                        }}
                        placeholder='Search chats...'
                        className='h-7 rounded-[6px] border bg-background px-2 text-xs focus-visible:ring-0 focus-visible:ring-offset-0'
                      />
                    </div>
                    <div className='h-px w-full bg-border my-1' />
                    <div className='max-h-64 overflow-auto'>
                      {isLoadingPastChats ? (
                        <div className='px-2 py-2 text-muted-foreground text-sm'>Loading...</div>
                      ) : pastChats.length === 0 ? (
                        <div className='px-2 py-2 text-muted-foreground text-sm'>No past chats</div>
                      ) : (
                        pastChats
                          .filter((c) =>
                            (c.title || 'Untitled Chat')
                              .toLowerCase()
                              .includes(pastChatsQuery.toLowerCase())
                          )
                          .map((chat, idx) => (
                            <div
                              key={chat.id}
                              className={cn(
                                'flex items-center gap-2 rounded-[6px] px-2 py-1.5 text-sm hover:bg-muted/60',
                                submenuActiveIndex === idx && 'bg-muted'
                              )}
                              role='menuitem'
                              aria-selected={submenuActiveIndex === idx}
                              onMouseEnter={() => setSubmenuActiveIndex(idx)}
                              onClick={() => insertPastChatMention(chat)}
                            >
                              {chat.workflowId && chat.workflowId === workflowId ? (
                                <Package className='h-3.5 w-3.5 text-muted-foreground' />
                              ) : (
                                <div className='h-3.5 w-3.5' />
                              )}
                              <span className='truncate'>{chat.title || 'Untitled Chat'}</span>
                            </div>
                          ))
                      )}
                    </div>
                  </div>
                )}

                {openSubmenuFor === 'Workflow' && (
                  <div
                    ref={submenuRef}
                    className='absolute bottom-full z-50 mb-1 left-[calc(14rem+4px)] w-72 rounded-[8px] border bg-popover p-1 text-foreground shadow-md max-h-64 overflow-auto'
                  >
                    <div className='px-2 py-1.5 text-muted-foreground text-xs'>Workflows</div>
                    <div className='px-2 pb-1'>
                      <Input
                        value={workflowsQuery}
                        onChange={(e) => {
                          setWorkflowsQuery(e.target.value)
                          setSubmenuActiveIndex(0)
                        }}
                        placeholder='Search workflows...'
                        className='h-7 rounded-[6px] border bg-background px-2 text-xs focus-visible:ring-0 focus-visible:ring-offset-0'
                      />
                    </div>
                    <div className='h-px w-full bg-border my-1' />
                    <div className='max-h-64 overflow-auto'>
                      {isLoadingWorkflows ? (
                        <div className='px-2 py-2 text-muted-foreground text-sm'>Loading...</div>
                      ) : workflows.length === 0 ? (
                        <div className='px-2 py-2 text-muted-foreground text-sm'>No workflows</div>
                      ) : (
                        workflows
                          .filter((w) =>
                            (w.name || 'Untitled Workflow')
                              .toLowerCase()
                              .includes(workflowsQuery.toLowerCase())
                          )
                          .map((wf, idx) => (
                            <div
                              key={wf.id}
                              className={cn(
                                'flex items-center gap-2 rounded-[6px] px-2 py-1.5 text-sm hover:bg-muted/60',
                                submenuActiveIndex === idx && 'bg-muted'
                              )}
                              role='menuitem'
                              aria-selected={submenuActiveIndex === idx}
                              onMouseEnter={() => setSubmenuActiveIndex(idx)}
                              onClick={() => insertWorkflowMention(wf)}
                            >
                              <div className='h-3.5 w-3.5' />
                              <span className='truncate'>{wf.name || 'Untitled Workflow'}</span>
                            </div>
                          ))
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Bottom Row: Mode Selector + Attach Button + Send Button */}
          <div className='flex items-center justify-between'>
            {/* Left side: Mode Selector and Depth (if Agent) */}
            <div className='flex items-center gap-1.5'>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant='ghost'
                    size='sm'
                    disabled={!onModeChange}
                    className='flex h-6 items-center gap-1.5 rounded-full border px-2 py-1 font-medium text-xs'
                  >
                    {getModeIcon()}
                    <span>{getModeText()}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='start' className='p-0'>
                  <TooltipProvider>
                    <div className='w-[160px] p-1'>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <DropdownMenuItem
                            onSelect={() => onModeChange?.('ask')}
                            className={cn(
                              'flex items-center justify-between rounded-sm px-2 py-1.5 text-xs leading-4',
                              mode === 'ask' && 'bg-muted/40'
                            )}
                          >
                            <span className='flex items-center gap-1.5'>
                              <MessageCircle className='h-3 w-3 text-muted-foreground' />
                              Ask
                            </span>
                            {mode === 'ask' && <Check className='h-3 w-3 text-muted-foreground' />}
                          </DropdownMenuItem>
                        </TooltipTrigger>
                        <TooltipContent
                          side='right'
                          sideOffset={6}
                          align='center'
                          className='max-w-[220px] border bg-popover p-2 text-[11px] text-popover-foreground leading-snug shadow-md'
                        >
                          Ask mode can help answer questions about your workflow, tell you about
                          Sim, and guide you in building/editing.
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <DropdownMenuItem
                            onSelect={() => onModeChange?.('agent')}
                            className={cn(
                              'flex items-center justify-between rounded-sm px-2 py-1.5 text-xs leading-4',
                              mode === 'agent' && 'bg-muted/40'
                            )}
                          >
                            <span className='flex items-center gap-1.5'>
                              <Package className='h-3 w-3 text-muted-foreground' />
                              Agent
                            </span>
                            {mode === 'agent' && (
                              <Check className='h-3 w-3 text-muted-foreground' />
                            )}
                          </DropdownMenuItem>
                        </TooltipTrigger>
                        <TooltipContent
                          side='right'
                          sideOffset={6}
                          align='center'
                          className='max-w-[220px] border bg-popover p-2 text-[11px] text-popover-foreground leading-snug shadow-md'
                        >
                          Agent mode can build, edit, and interact with your workflows (Recommended)
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </TooltipProvider>
                </DropdownMenuContent>
              </DropdownMenu>
              {
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant='ghost'
                      size='sm'
                      className={cn(
                        'flex h-6 items-center gap-1.5 rounded-full border px-2 py-1 font-medium text-xs',
                        !agentPrefetch
                          ? 'border-[var(--brand-primary-hover-hex)] text-[var(--brand-primary-hover-hex)] hover:bg-[color-mix(in_srgb,var(--brand-primary-hover-hex)_8%,transparent)] hover:text-[var(--brand-primary-hover-hex)]'
                          : 'border-border text-foreground'
                      )}
                      title='Choose mode'
                    >
                      {getDepthIcon()}
                      <span>{getCollapsedModeLabel()}</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='start' className='p-0'>
                    <TooltipProvider delayDuration={100} skipDelayDuration={0}>
                      <div className='w-[260px] p-3'>
                        <div className='mb-3 flex items-center justify-between'>
                          <div className='flex items-center gap-1.5'>
                            <span className='font-medium text-xs'>MAX mode</span>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type='button'
                                  className='h-3.5 w-3.5 rounded text-muted-foreground transition-colors hover:text-foreground'
                                  aria-label='MAX mode info'
                                >
                                  <Info className='h-3.5 w-3.5' />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent
                                side='right'
                                sideOffset={6}
                                align='center'
                                className='max-w-[220px] border bg-popover p-2 text-[11px] text-popover-foreground leading-snug shadow-md'
                              >
                                Significantly increases depth of reasoning
                                <br />
                                <span className='text-[10px] text-muted-foreground italic'>
                                  Only available in Advanced and Behemoth modes
                                </span>
                              </TooltipContent>
                            </Tooltip>
                          </div>
                          <Switch
                            checked={!agentPrefetch}
                            disabled={agentDepth < 2}
                            title={
                              agentDepth < 2
                                ? 'MAX mode is only available for Advanced or Expert'
                                : undefined
                            }
                            onCheckedChange={(checked) => {
                              if (agentDepth < 2) return
                              setAgentPrefetch(!checked)
                            }}
                          />
                        </div>
                        <div className='my-2 flex justify-center'>
                          <div className='h-px w-[100%] bg-border' />
                        </div>
                        <div className='mb-3'>
                          <div className='mb-2 flex items-center justify-between'>
                            <span className='font-medium text-xs'>Mode</span>
                            <div className='flex items-center gap-1'>
                              {getDepthIconFor(agentDepth)}
                              <span className='text-muted-foreground text-xs'>
                                {getDepthLabelFor(agentDepth)}
                              </span>
                            </div>
                          </div>
                          <div className='relative'>
                            <CopilotSlider
                              min={0}
                              max={3}
                              step={1}
                              value={[agentDepth]}
                              onValueChange={(val) =>
                                setAgentDepth((val?.[0] ?? 0) as 0 | 1 | 2 | 3)
                              }
                            />
                            <div className='pointer-events-none absolute inset-0'>
                              <div className='-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-[33.333%] h-2 w-[3px] bg-background' />
                              <div className='-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-[66.667%] h-2 w-[3px] bg-background' />
                            </div>
                          </div>
                        </div>
                        <div className='mt-3 text-[11px] text-muted-foreground'>
                          {getDepthDescription(agentDepth)}
                        </div>
                      </div>
                    </TooltipProvider>
                  </DropdownMenuContent>
                </DropdownMenu>
              }
            </div>

            {/* Right side: Attach Button + Send Button */}
            <div className='flex items-center gap-1'>
              {/* Attach Button */}
              <Button
                variant='ghost'
                size='icon'
                onClick={handleFileSelect}
                disabled={disabled || isLoading}
                className='h-6 w-6 text-muted-foreground hover:text-foreground'
                title='Attach file'
              >
                <Paperclip className='h-3 w-3' />
              </Button>

              {/* Send Button */}
              {showAbortButton ? (
                <Button
                  onClick={handleAbort}
                  disabled={isAborting}
                  size='icon'
                  className='h-6 w-6 rounded-full bg-red-500 text-white transition-all duration-200 hover:bg-red-600'
                  title='Stop generation'
                >
                  {isAborting ? (
                    <Loader2 className='h-3 w-3 animate-spin' />
                  ) : (
                    <X className='h-3 w-3' />
                  )}
                </Button>
              ) : (
                <Button
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  size='icon'
                  className='h-6 w-6 rounded-full bg-[var(--brand-primary-hover-hex)] text-white shadow-[0_0_0_0_var(--brand-primary-hover-hex)] transition-all duration-200 hover:bg-[var(--brand-primary-hover-hex)] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]'
                >
                  {isLoading ? (
                    <Loader2 className='h-3 w-3 animate-spin' />
                  ) : (
                    <ArrowUp className='h-3 w-3' />
                  )}
                </Button>
              )}
            </div>
          </div>

          {/* Hidden File Input */}
          <input
            ref={fileInputRef}
            type='file'
            onChange={handleFileChange}
            className='hidden'
            accept='.pdf,.doc,.docx,.txt,.md,.png,.jpg,.jpeg,.gif'
            multiple
            disabled={disabled || isLoading}
          />
        </div>
      </div>
    )
  }
)

UserInput.displayName = 'UserInput'

export { UserInput }
export type { UserInputRef }
