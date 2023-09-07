import { createServer } from 'http'
import crypto from 'crypto'
import { ftruncate } from 'fs'

const PORT = 3333
const WEBSOCKET_MAGIC_STRING_KEY = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const SEVEN_BITS_MARKER = 125
const SIXTEEN_BITS_MARKER = 126
const SEXTYFOUR_BITS_MARKER = 127
const FIRST_BIT = 128
const MASK_KEY_BYTES_LENGTH = 4
const OPCODE_TEXT = 0x01
const MAXIMUN_SIXTEEN_BITS = 2 ** 16 // 0 to 65536

const server = createServer((req, res) => {
  res.writeHead(200)
  res.end('Hello World')
})
.listen(PORT, () => console.log(`Listening on port ${PORT}`))

server.on('upgrade', onSocketUpgrade)

function onSocketUpgrade(req, socket, head) {
  const { 'sec-websocket-key': webClientKey } = req.headers
  console.log(`${webClientKey} connected!`)
  const headers = prepareHandShakeHeaders(webClientKey)
  socket.write(headers)
  socket.on('readable', () => onSocketReadable(socket))
}

function sendMessage(msg, socket) {
  const data = prepareMesasge(msg)
  socket.write(data)
}

function prepareMesasge(message) {
  const msg = Buffer.from(message)
  const msgSize = msg.length

  let dataFrameBuffer

  const firstByte = 0x80 | OPCODE_TEXT
  if(msgSize <= SEVEN_BITS_MARKER) {
    const bytes = [firstByte]
    dataFrameBuffer = Buffer.from(bytes.concat(msgSize))
  } else if(msgSize <= MAXIMUN_SIXTEEN_BITS) {
    const offset = 4
    const target = Buffer.allocUnsafe(offset)
    target[0] = firstByte
    target[1] = SIXTEEN_BITS_MARKER | 0x0
    target.writeUInt16BE(msgSize, 2)
    dataFrameBuffer = target
  } else {
    throw new Error('Invalid message length')
  }

  const totalLength = dataFrameBuffer.byteLength + msgSize
  const dataFrameResponse = concatBuffers([ dataFrameBuffer, msg ], totalLength)
  return dataFrameResponse
}

function concatBuffers(buffers, totalLength) {
  const target = Buffer.allocUnsafe(totalLength)
  let offset = 0
  for(const buffer of buffers) {
    target.set(buffer, offset)
    offset += buffer.length
  }
  return target
}

function onSocketReadable(socket) {
  // consume optcode (first byte)
  socket.read(1)

  const [ makerkerAndPayloadLength ] = socket.read(1)
  const lengthIndicatorInBits = makerkerAndPayloadLength - FIRST_BIT

  let messageLength = 0
  if(lengthIndicatorInBits <= SEVEN_BITS_MARKER) {
    messageLength = lengthIndicatorInBits
  } else if(lengthIndicatorInBits === SIXTEEN_BITS_MARKER) {
    // unsigned, big-endian 16-bit integer 0 - 65k
    messageLength = socket.read(2).readUint16BE(0)
  } else {
    throw new Error('Invalid message length')
  }

  const maskKey = socket.read(MASK_KEY_BYTES_LENGTH)
  const encoded = socket.read(messageLength)
  const decoded = unmaskData(encoded, maskKey)
  const received = decoded.toString('utf-8')
  console.log(received)
  const data = JSON.parse(received)
  
  const msg = JSON.stringify({
    message: data,
    at: new Date()
  })
  sendMessage(msg, socket)
}

function unmaskData(encodedBuffer, maskKey) {
  const fillWithEightZeros = (t) => t.padStart(8, '0')
  const toBinary = (t) => fillWithEightZeros(t.toString(2))
  const fromBinaryToDecimal = (t) => parseInt(toBinary(t), 2)
  const getCharFrombinary = (t) => String.fromCharCode(fromBinaryToDecimal(t))

  const decodedBuffer = Buffer.from(encodedBuffer)
  for(let index = 0; index < decodedBuffer.length; index++) {
    decodedBuffer[index] = encodedBuffer[index] ^ maskKey[index % 4]

    const logger = {
      unmaskingCalc : `${toBinary(decodedBuffer[index])} ^ ${toBinary(maskKey[index % 4])} = ${toBinary(decodedBuffer[index])}`,
      decoded: getCharFrombinary(decodedBuffer[index])
    }
    console.log(logger)
  }
  return decodedBuffer
}

function prepareHandShakeHeaders(key) {
  const acceptKey = createSocketAccept(key)
  const handShakeHeaders = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`,
    '',
  ].map(line => line.concat('\r\n')).join('')

  return handShakeHeaders
}

function createSocketAccept(key) {
  const shaOne = crypto.createHash('sha1')
  shaOne.update(key + WEBSOCKET_MAGIC_STRING_KEY)
  return shaOne.digest('base64')
}

// error handling to keep the server on
;
[
  "uncaughtException",
  "unhandledRejection"
].forEach(event => process.on(event, (err) => {
  console.log(`Something bad happened, event: ${event}, error: ${err}`)
}))