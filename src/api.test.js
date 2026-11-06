import { describe, expect, it, vi } from 'vitest'
import { clearChatMemory, readEventStream, streamChat, streamImageChat } from './api'

function responseFromChunks(chunks) {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)))
      controller.close()
    },
  }), { headers: { 'Content-Type': 'text/event-stream' } })
}

describe('readEventStream', () => {
  it('joins split SSE frames and preserves multiline data', async () => {
    const chunks = []
    const response = responseFromChunks(['data: 你好\r', '\n\r\ndata: 第二行\ndata: 继续\n\n'])
    await readEventStream(response, (chunk) => chunks.push(chunk))
    expect(chunks).toEqual(['你好', '第二行\n继续'])
  })

  it('reports an HTTP error body', async () => {
    await expect(readEventStream(new Response('图片格式错误', { status: 400 }), vi.fn()))
      .rejects.toThrow('图片格式错误')
    await expect(readEventStream(new Response(JSON.stringify({ detail: '请输入消息内容' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    }), vi.fn())).rejects.toThrow('请输入消息内容')
  })
})

describe('chat requests', () => {
  it('sends text as JSON and consumes the event stream', async () => {
    const fetchMock = vi.fn().mockResolvedValue(responseFromChunks(['data: ok\n\n']))
    vi.stubGlobal('fetch', fetchMock)
    const chunks = []
    await streamChat('93449a7e-cc69-42c9-a5f1-cb97390d9481', '你好', (part) => chunks.push(part))
    expect(fetchMock.mock.calls[0][0]).toBe('/chat')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      memoryId: '93449a7e-cc69-42c9-a5f1-cb97390d9481',
      message: '你好',
    })
    expect(chunks).toEqual(['ok'])
  })

  it('sends the image and optional question as multipart form data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(responseFromChunks(['data: 描述\n\n']))
    vi.stubGlobal('fetch', fetchMock)
    const file = new File(['image'], 'photo.png', { type: 'image/png' })
    await streamImageChat('93449a7e-cc69-42c9-a5f1-cb97390d9481', file, '这是什么？', vi.fn())
    const [, options] = fetchMock.mock.calls[0]
    expect(fetchMock.mock.calls[0][0]).toBe('/chat/img')
    expect(options.body.get('file')).toBe(file)
    expect(options.body.get('memoryId')).toBe('93449a7e-cc69-42c9-a5f1-cb97390d9481')
    expect(options.body.get('message')).toBe('这是什么？')
    expect(options.headers['Content-Type']).toBeUndefined()
  })

  it('clears memory for the requested conversation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await clearChatMemory('93449a7e-cc69-42c9-a5f1-cb97390d9481')

    expect(fetchMock).toHaveBeenCalledWith('/chat/93449a7e-cc69-42c9-a5f1-cb97390d9481', {
      method: 'DELETE',
    })
  })
})
