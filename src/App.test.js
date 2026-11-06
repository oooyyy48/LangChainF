import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const apiMocks = vi.hoisted(() => ({
  streamChat: vi.fn(),
  streamImageChat: vi.fn(),
  clearChatMemory: vi.fn(),
}))

vi.mock('./api', () => apiMocks)

import App from './App.vue'

async function waitForCondition(check) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
    await flushPromises()
  }
  throw new Error('Timed out waiting for the rendered response')
}

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((query) => ({
      matches: query.includes('no-preference'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('chat interface', () => {
  it('collapses the desktop sidebar to an icon rail and expands it again', async () => {
    const wrapper = mount(App)
    const sidebar = wrapper.find('.sidebar')

    expect(sidebar.classes()).not.toContain('sidebar-collapsed')
    await wrapper.get('button[aria-label="收起侧栏"]').trigger('click')
    expect(sidebar.classes()).toContain('sidebar-collapsed')
    expect(wrapper.find('button[aria-label="展开侧栏"]').exists()).toBe(true)

    await wrapper.get('button[aria-label="展开侧栏"]').trigger('click')
    expect(sidebar.classes()).not.toContain('sidebar-collapsed')
    wrapper.unmount()
  })

  it('renders streamed text and lets the user create another conversation', async () => {
    apiMocks.streamChat.mockImplementation(async (_memoryId, _message, onChunk) => {
      onChunk('你好，')
      onChunk('这里是回答。')
    })
    const wrapper = mount(App)

    await wrapper.get('textarea[aria-label="输入消息"]').setValue('你好')
    await wrapper.get('button[aria-label="发送"]').trigger('click')
    await flushPromises()
    await waitForCondition(() => wrapper.find('.assistant-markdown').text() === '你好，这里是回答。')

    expect(apiMocks.streamChat).toHaveBeenCalledWith(
      expect.any(String), '你好', expect.any(Function), expect.any(AbortSignal),
    )
    const firstMemoryId = apiMocks.streamChat.mock.calls[0][0]
    expect(wrapper.findAll('.message-row')).toHaveLength(2)

    await wrapper.get('.new-chat-button').trigger('click')
    expect(wrapper.findAll('.conversation-entry')).toHaveLength(2)
    expect(wrapper.find('.welcome-state').exists()).toBe(true)
    await wrapper.get('textarea[aria-label="输入消息"]').setValue('另一个会话')
    await wrapper.get('button[aria-label="发送"]').trigger('click')
    await flushPromises()
    const secondMemoryId = apiMocks.streamChat.mock.calls[1][0]
    expect(secondMemoryId).not.toBe(firstMemoryId)
    wrapper.unmount()
  })

  it('keeps each assistant paragraph in its own island', async () => {
    apiMocks.streamChat.mockImplementation(async (_memoryId, _message, onChunk) => {
      onChunk('第一段回答。\n\n第二段补充说明。')
    })
    const wrapper = mount(App)
    await wrapper.get('textarea[aria-label="输入消息"]').setValue('介绍一下')
    await wrapper.get('button[aria-label="发送"]').trigger('click')
    await flushPromises()
    await waitForCondition(() => wrapper.findAll('.assistant-markdown > p').length === 2)

    expect(wrapper.findAll('.assistant-markdown > p')).toHaveLength(2)
    expect(wrapper.findAll('.assistant-markdown > p').map((paragraph) => paragraph.text()))
      .toEqual(['第一段回答。', '第二段补充说明。'])
    wrapper.unmount()
  })

  it('clears backend memory before clearing the visible conversation', async () => {
    apiMocks.streamChat.mockImplementation(async (_memoryId, _message, onChunk) => onChunk('已有上下文'))
    const wrapper = mount(App)
    await wrapper.get('textarea[aria-label="输入消息"]').setValue('先聊聊')
    await wrapper.get('button[aria-label="发送"]').trigger('click')
    await flushPromises()
    await waitForCondition(() => wrapper.find('.assistant-markdown').exists())
    await waitForCondition(() => !wrapper.get('.text-action').element.disabled)

    await wrapper.get('.text-action').trigger('click')
    await flushPromises()

    expect(apiMocks.clearChatMemory).toHaveBeenCalledWith(apiMocks.streamChat.mock.calls[0][0])
    expect(wrapper.find('.welcome-state').exists()).toBe(true)
    wrapper.unmount()
  })

  it('uploads an image with an optional question and shows it in the conversation', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:preview')
    URL.revokeObjectURL = vi.fn()
    apiMocks.streamImageChat.mockImplementation(async (_memoryId, _file, _message, onChunk) => onChunk('这是图片回答'))
    const wrapper = mount(App)
    const input = wrapper.get('input[type="file"]')
    const file = new File(['pixels'], 'photo.png', { type: 'image/png' })
    Object.defineProperty(input.element, 'files', { configurable: true, value: [file] })
    await input.trigger('change')

    expect(wrapper.find('.attachment-preview img').attributes('src')).toBe('blob:preview')
    await wrapper.get('textarea[aria-label="输入消息"]').setValue('这是什么？')
    await wrapper.get('button[aria-label="发送"]').trigger('click')
    await flushPromises()
    await waitForCondition(() => wrapper.find('.assistant-markdown').text() === '这是图片回答')

    expect(apiMocks.streamImageChat).toHaveBeenCalledWith(
      expect.any(String), file, '这是什么？', expect.any(Function), expect.any(AbortSignal),
    )
    expect(wrapper.find('.message-user .message-image').exists()).toBe(true)
    wrapper.unmount()
  })

  it('aborts an in-flight response when stop is pressed', async () => {
    let resolveRequest
    apiMocks.streamChat.mockImplementation(() => new Promise((resolve) => { resolveRequest = resolve }))
    const wrapper = mount(App)
    await wrapper.get('textarea[aria-label="输入消息"]').setValue('继续')
    await wrapper.get('button[aria-label="发送"]').trigger('click')
    const signal = apiMocks.streamChat.mock.calls[0][3]
    await wrapper.get('button[aria-label="停止生成"]').trigger('click')

    expect(signal.aborted).toBe(true)
    resolveRequest()
    await flushPromises()
    wrapper.unmount()
  })

  it('rejects non-image files before sending', async () => {
    const wrapper = mount(App)
    const input = wrapper.get('input[type="file"]')
    const file = new File(['text'], 'notes.txt', { type: 'text/plain' })
    Object.defineProperty(input.element, 'files', { configurable: true, value: [file] })
    await input.trigger('change')

    expect(wrapper.get('[role="alert"]').text()).toContain('请选择图片格式')
    expect(apiMocks.streamImageChat).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
