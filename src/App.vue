<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import DOMPurify from 'dompurify'
import { gsap } from 'gsap'
import MarkdownIt from 'markdown-it'
import {
  ArrowDown,
  ArrowRight,
  Check,
  Lightbulb,
  Menu,
  MessageSquare,
  Paperclip,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Send,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-vue-next'
import { clearChatMemory, streamChat, streamImageChat } from './api'

const markdown = new MarkdownIt({ breaks: true, linkify: true })
const conversations = ref([createConversation()])
const activeId = ref(conversations.value[0].id)
const input = ref('')
const selectedFile = ref(null)
const selectedPreview = ref('')
const sending = ref(false)
const error = ref('')
const mobileSidebarOpen = ref(false)
const sidebarCollapsed = ref(false)
const editingTitleId = ref('')
const titleDraft = ref('')
const fileInput = ref(null)
const messageList = ref(null)
const inputArea = ref(null)
let controller = null
const imageUrls = new Set()
const textAnimations = new Set()
const entranceTimelines = new Set()
const motion = gsap.matchMedia()
let motionEnabled = false
motion.add('(prefers-reduced-motion: no-preference)', () => {
  motionEnabled = true
  return () => {
    motionEnabled = false
    entranceTimelines.forEach((timeline) => timeline.kill())
    entranceTimelines.clear()
  }
})

const activeConversation = computed(() =>
  conversations.value.find((conversation) => conversation.id === activeId.value),
)
const messages = computed(() => activeConversation.value?.messages ?? [])
const isEmpty = computed(() => messages.value.length === 0)
const canSend = computed(() => !sending.value && (input.value.trim() || selectedFile.value))

function createConversation() {
  return { id: crypto.randomUUID(), title: '新对话', messages: [] }
}

function scrollToLatest() {
  nextTick(() => {
    if (messageList.value) messageList.value.scrollTop = messageList.value.scrollHeight
  })
}

function animateMessageEntrance() {
  if (!motionEnabled) return
  nextTick(() => {
    const rows = [...(messageList.value?.querySelectorAll('.message-row') ?? [])].slice(-2)
    if (rows.length < 2) return

    let timeline
    timeline = gsap.timeline({
      defaults: { ease: 'power3.out' },
      onComplete: () => entranceTimelines.delete(timeline),
    })
    entranceTimelines.add(timeline)
    timeline
      .fromTo(rows[0], { autoAlpha: 0, y: 14, scale: 0.97 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.34 })
      .fromTo(rows[1], { autoAlpha: 0, y: 10, scale: 0.985 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.28 }, '-=0.1')
  })
}

function splitCharacters(text) {
  if (typeof Intl.Segmenter === 'function') {
    return [...new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }).segment(text)]
      .map(({ segment }) => segment)
  }
  return Array.from(text)
}

function revealChunk(message, state, chunk) {
  state.target += chunk
  const characters = splitCharacters(state.target)
  if (state.tween) state.tween.kill()

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    state.rendered = characters.length
    message.text = state.target
    return
  }

  if (state.rendered === 0 && characters.length > 0) {
    state.rendered = 1
    message.text = characters[0]
    scrollToLatest()
  }
  if (characters.length <= state.rendered) return
  state.tween = gsap.to(state, {
    rendered: characters.length,
    duration: Math.max(0.12, (characters.length - state.rendered) * 0.024),
    ease: 'none',
    snap: { rendered: 1 },
    onUpdate: () => {
      message.text = characters.slice(0, Math.floor(state.rendered)).join('')
      scrollToLatest()
    },
    onComplete: () => {
      state.tween = null
      message.text = state.target
      textAnimations.delete(state)
      state.waiters.splice(0).forEach((resolve) => resolve())
    },
  })
  textAnimations.add(state)
}

function finishTextAnimation(state) {
  if (state.rendered >= splitCharacters(state.target).length) return Promise.resolve()
  return new Promise((resolve) => state.waiters.push(resolve))
}

function newConversation() {
  const conversation = createConversation()
  conversations.value.unshift(conversation)
  activeId.value = conversation.id
  mobileSidebarOpen.value = false
  error.value = ''
  nextTick(() => inputArea.value?.focus())
}

function selectConversation(id) {
  activeId.value = id
  mobileSidebarOpen.value = false
  error.value = ''
  scrollToLatest()
}

async function clearConversation() {
  if (!activeConversation.value || sending.value) return
  const conversation = activeConversation.value
  error.value = ''
  try {
    await clearChatMemory(conversation.id)
  } catch (requestError) {
    error.value = requestError.message || '清空会话失败，请稍后重试。'
    return
  }
  for (const message of activeConversation.value.messages) {
    if (message.imageUrl) releaseImageUrl(message.imageUrl)
  }
  conversation.messages = []
  conversation.title = '新对话'
}

function beginRename(conversation) {
  editingTitleId.value = conversation.id
  titleDraft.value = conversation.title
  nextTick(() => document.querySelector('.rename-input')?.focus())
}

function saveRename(conversation) {
  const title = titleDraft.value.trim()
  if (title) conversation.title = title.slice(0, 36)
  editingTitleId.value = ''
}

function triggerFilePicker() {
  if (!sending.value) fileInput.value?.click()
}

function releaseImageUrl(url) {
  if (imageUrls.has(url)) {
    URL.revokeObjectURL(url)
    imageUrls.delete(url)
  }
}

function removeSelectedFile() {
  if (selectedPreview.value) releaseImageUrl(selectedPreview.value)
  selectedPreview.value = ''
  selectedFile.value = null
  if (fileInput.value) fileInput.value.value = ''
}

function handleFile(event) {
  const file = event.target.files?.[0]
  if (!file) return
  error.value = ''
  if (!file.type.startsWith('image/')) {
    error.value = '请选择图片格式的文件。'
    event.target.value = ''
    return
  }
  if (file.size > 10 * 1024 * 1024) {
    error.value = '图片大小不能超过 10 MB。'
    event.target.value = ''
    return
  }
  removeSelectedFile()
  selectedFile.value = file
  selectedPreview.value = URL.createObjectURL(file)
  imageUrls.add(selectedPreview.value)
}

function handlePaste(event) {
  const image = [...(event.clipboardData?.items ?? [])]
    .find((item) => item.type.startsWith('image/'))?.getAsFile()
  if (!image) return
  event.preventDefault()
  const transfer = new DataTransfer()
  transfer.items.add(image)
  if (fileInput.value) {
    fileInput.value.files = transfer.files
    handleFile({ target: fileInput.value })
  }
}

function renderedMarkdown(text) {
  return DOMPurify.sanitize(markdown.render(text || ''))
}

async function sendMessage() {
  if (!canSend.value || !activeConversation.value) return
  const prompt = input.value.trim()
  const file = selectedFile.value
  const imageUrl = file ? selectedPreview.value : ''
  const shownPrompt = prompt || (file ? '请描述这张图片' : '')
  if (!shownPrompt) return

  const conversation = activeConversation.value
  const userMessage = { id: crypto.randomUUID(), role: 'user', text: shownPrompt, imageUrl }
  const assistantMessage = { id: crypto.randomUUID(), role: 'assistant', text: '' }
  conversation.messages.push(userMessage, assistantMessage)
  if (conversation.title === '新对话') conversation.title = shownPrompt.slice(0, 24)
  input.value = ''
  selectedFile.value = null
  selectedPreview.value = ''
  if (fileInput.value) fileInput.value.value = ''
  error.value = ''
  sending.value = true
  const requestController = new AbortController()
  controller = requestController
  scrollToLatest()
  animateMessageEntrance()
  const textState = { target: '', rendered: 0, tween: null, waiters: [] }

  try {
    const onChunk = (chunk) => {
      revealChunk(assistantMessage, textState, chunk)
    }
    if (file) {
      await streamImageChat(conversation.id, file, prompt, onChunk, requestController.signal)
    } else {
      await streamChat(conversation.id, prompt, onChunk, requestController.signal)
    }
    await finishTextAnimation(textState)
  } catch (requestError) {
    if (requestError.name !== 'AbortError') {
      error.value = requestError.message || '请求失败，请稍后重试。'
      if (!assistantMessage.text) conversation.messages.pop()
    }
  } finally {
    if (controller === requestController) controller = null
    sending.value = false
    scrollToLatest()
  }
}

function stopGeneration() {
  controller?.abort()
}

function useSuggestion(text) {
  input.value = text
  inputArea.value?.focus()
}

watch(messages, scrollToLatest, { deep: true })
onBeforeUnmount(() => {
  controller?.abort()
  motion.revert()
  entranceTimelines.forEach((timeline) => timeline.kill())
  entranceTimelines.clear()
  for (const state of textAnimations) {
    state.tween?.kill()
    state.waiters.splice(0).forEach((resolve) => resolve())
  }
  textAnimations.clear()
  for (const url of imageUrls) URL.revokeObjectURL(url)
  imageUrls.clear()
})
</script>

<template>
  <div class="app-shell">
    <button
      v-if="mobileSidebarOpen"
      class="sidebar-scrim"
      aria-label="关闭会话列表"
      @click="mobileSidebarOpen = false"
    />
    <aside class="sidebar" :class="{ 'sidebar-open': mobileSidebarOpen, 'sidebar-collapsed': sidebarCollapsed }">
      <div class="brand-row">
        <div class="brand-mark"><Sparkles :size="22" :stroke-width="2.2" /></div>
        <span class="brand-name">LangChainF</span>
        <button
          class="icon-button sidebar-toggle"
          :aria-label="sidebarCollapsed ? '展开侧栏' : '收起侧栏'"
          :title="sidebarCollapsed ? '展开侧栏' : '收起侧栏'"
          @click="sidebarCollapsed = !sidebarCollapsed"
        >
          <PanelLeftOpen v-if="sidebarCollapsed" :size="18" />
          <PanelLeftClose v-else :size="18" />
        </button>
        <button class="icon-button sidebar-close" aria-label="关闭侧栏" @click="mobileSidebarOpen = false">
          <X :size="19" />
        </button>
      </div>

      <button class="new-chat-button" aria-label="新建对话" title="新建对话" @click="newConversation">
        <Plus :size="19" />
        <span class="new-chat-label">新建对话</span>
      </button>

      <div class="conversation-heading">最近对话</div>
      <nav class="conversation-list" aria-label="最近对话">
        <div v-for="conversation in conversations" :key="conversation.id" class="conversation-wrap">
          <div
            v-if="editingTitleId !== conversation.id"
            class="conversation-entry"
            :class="{ selected: activeId === conversation.id }"
          >
            <button class="conversation-item" @click="selectConversation(conversation.id)">
              <MessageSquare :size="17" :stroke-width="1.8" />
              <span class="conversation-title">{{ conversation.title }}</span>
            </button>
            <button
              v-if="activeId === conversation.id && conversation.title !== '新对话'"
              class="rename-button"
              aria-label="重命名对话"
              title="重命名对话"
              @click.stop="beginRename(conversation)"
            >
              <Pencil :size="14" />
            </button>
          </div>
          <form v-else class="rename-form" @submit.prevent="saveRename(conversation)">
            <input v-model="titleDraft" class="rename-input" maxlength="36" aria-label="对话名称" />
            <button class="icon-button rename-save" aria-label="保存名称"><Check :size="16" /></button>
          </form>
        </div>
      </nav>

      <div class="sidebar-bottom">
        <div class="connection-indicator" title="本地会话"><span class="status-dot" /><span>本地会话</span></div>
      </div>
    </aside>

    <main class="main-panel">
      <header class="topbar">
        <button class="icon-button mobile-menu" aria-label="打开会话列表" @click="mobileSidebarOpen = true">
          <Menu :size="20" />
        </button>
        <div class="topbar-title">{{ activeConversation?.title ?? '新对话' }}</div>
        <div class="topbar-actions">
          <button class="text-action" :disabled="isEmpty || sending" @click="clearConversation">
            <Trash2 :size="16" /><span class="action-label">清空对话</span>
          </button>
          <span class="toolbar-divider" />
          <button
            class="text-action rename-top-action"
            :disabled="sending || !activeConversation"
            @click="activeConversation && beginRename(activeConversation)"
          >
            <Pencil :size="16" /><span class="action-label">重命名</span>
          </button>
        </div>
      </header>

      <section ref="messageList" class="message-list" aria-live="polite" aria-label="聊天消息">
        <div v-if="isEmpty" class="welcome-state">
          <div class="welcome-symbol"><Sparkles :size="22" /></div>
          <h1>你好，我是 <span>LangChainF</span></h1>
          <p>你的 AI 助手，帮你高效获取信息、梳理思路、创作内容与解决问题。</p>
          <div class="suggestion-label">试试这样提问</div>
          <button class="suggestion-item" @click="useSuggestion('帮我写一份产品需求文档的框架')">
            <Lightbulb class="suggestion-bulb" :size="19" />
            <span>帮我写一份产品需求文档的框架</span>
            <ArrowRight :size="18" />
          </button>
          <button class="suggestion-item" @click="useSuggestion('用简单的例子解释 RAG 的工作原理')">
            <Lightbulb class="suggestion-bulb" :size="19" />
            <span>用简单的例子解释 RAG 的工作原理</span>
            <ArrowRight :size="18" />
          </button>
        </div>

        <div v-else class="messages-inner">
          <article
            v-for="message in messages"
            :key="message.id"
            class="message-row"
            :class="`message-${message.role}`"
          >
            <div class="avatar" :class="`avatar-${message.role}`">
              <Sparkles v-if="message.role === 'assistant'" :size="19" />
              <span v-else>你</span>
            </div>
            <div class="message-content">
              <div class="message-meta">
                <strong>{{ message.role === 'user' ? '你' : 'LangChainF' }}</strong>
                <span>{{ message.role === 'assistant' ? 'AI 助手' : '刚刚' }}</span>
              </div>
              <img v-if="message.imageUrl" class="message-image" :src="message.imageUrl" alt="你上传的图片" />
              <div v-if="message.role === 'user'" class="user-text">{{ message.text }}</div>
              <div
                v-else
                class="assistant-markdown"
                :class="{ 'is-streaming': sending && message === messages[messages.length - 1] }"
                v-html="renderedMarkdown(message.text)"
              />
              <span v-if="sending && message === messages[messages.length - 1] && message.role === 'assistant' && !message.text" class="typing-indicator" aria-label="正在生成">
                <i /><i /><i />
              </span>
            </div>
          </article>
        </div>
      </section>

      <div class="composer-area">
        <div v-if="error" class="error-banner" role="alert">
          <span>{{ error }}</span>
          <button class="icon-button" aria-label="关闭错误提示" @click="error = ''"><X :size="16" /></button>
        </div>
        <div v-if="selectedPreview" class="attachment-preview">
          <img :src="selectedPreview" alt="待发送图片预览" />
          <div class="attachment-details">
            <strong>{{ selectedFile?.name }}</strong>
            <span>{{ (selectedFile?.size / 1024 / 1024).toFixed(2) }} MB</span>
          </div>
          <button class="icon-button remove-attachment" aria-label="移除图片" @click="removeSelectedFile"><X :size="17" /></button>
        </div>
        <div class="composer">
          <input ref="fileInput" class="visually-hidden" type="file" accept="image/*" @change="handleFile" />
          <button class="attach-button" :disabled="sending" aria-label="添加图片" title="添加图片" @click="triggerFilePicker">
            <Paperclip :size="19" />
            <span>添加图片</span>
          </button>
          <span class="composer-divider" />
          <textarea
            ref="inputArea"
            v-model="input"
            rows="1"
            :disabled="sending"
            placeholder="输入你的问题，或粘贴内容进行提问..."
            aria-label="输入消息"
            @keydown.enter.exact.prevent="sendMessage"
            @paste="handlePaste"
          />
          <button v-if="sending" class="send-button stop-button" aria-label="停止生成" title="停止生成" @click="stopGeneration">
            <Square :size="16" fill="currentColor" />
          </button>
          <button v-else class="send-button" :disabled="!canSend" aria-label="发送" title="发送" @click="sendMessage">
            <Send :size="17" />
            <span>发送</span>
          </button>
        </div>
        <div class="composer-hint"><span>Enter 发送</span><span>Shift + Enter 换行</span><span>支持 PNG、JPG、WEBP，最大 10 MB</span></div>
      </div>
      <button v-if="!isEmpty" class="scroll-latest" aria-label="滚动到最新消息" @click="scrollToLatest"><ArrowDown :size="17" /></button>
    </main>
  </div>
</template>
