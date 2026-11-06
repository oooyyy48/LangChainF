export async function streamChat(memoryId, message, onChunk, signal) {
  const response = await fetch('/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ memoryId, message }),
    signal,
  })

  return readEventStream(response, onChunk)
}

export async function streamImageChat(memoryId, file, message, onChunk, signal) {
  const form = new FormData()
  form.append('memoryId', memoryId)
  form.append('file', file)
  if (message.trim()) form.append('message', message.trim())

  const response = await fetch('/chat/img', {
    method: 'POST',
    headers: { Accept: 'text/event-stream' },
    body: form,
    signal,
  })

  return readEventStream(response, onChunk)
}

export async function clearChatMemory(memoryId) {
  const response = await fetch(`/chat/${encodeURIComponent(memoryId)}`, {
    method: 'DELETE',
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(body || `清空会话失败 (${response.status})`)
  }
}

export async function readEventStream(response, onChunk) {
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    let detail = body
    try {
      const parsed = JSON.parse(body)
      detail = parsed.detail || parsed.message || parsed.error || body
    } catch {
      // Plain text error responses are displayed as-is.
    }
    throw new Error(detail || `请求失败 (${response.status})`)
  }
  if (!response.body) throw new Error('浏览器未能读取流式响应')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let dataLines = []

  const dispatch = () => {
    if (dataLines.length) onChunk(dataLines.join('\n'))
    dataLines = []
  }

  const processLine = (line) => {
    if (line === '') {
      dispatch()
      return
    }
    if (line.startsWith(':')) return
    const separator = line.indexOf(':')
    const field = separator === -1 ? line : line.slice(0, separator)
    if (field !== 'data') return
    let value = separator === -1 ? '' : line.slice(separator + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    dataLines.push(value)
  }

  try {
    while (true) {
      const { value, done } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) processLine(line)
      if (done) break
    }
    if (buffer) processLine(buffer)
    dispatch()
  } finally {
    reader.releaseLock()
  }
}
