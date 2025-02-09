"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Peer, type DataConnection } from "peerjs"
import { QRCodeSVG } from "qrcode.react"
import { useDropzone } from "react-dropzone"
import { Chat } from "./chat"
import { TransferHistory } from "./transfer-history"
import { FileAnnotation } from "./file-annotation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { AlertCircle, Copy, Link, File, Moon, Sun, Upload } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

interface FileMetadata {
  name: string
  type: string
  size: number
  totalChunks: number
}

interface FileChunk {
  index: number
  data: Uint8Array
}

interface TransferRecord {
  id: string
  fileName: string
  fileType: string
  fileSize: number
  timestamp: number
  direction: "sent" | "received"
}

export default function Home() {
  const [peerId, setPeerId] = useState<string>("")
  const [peer, setPeer] = useState<Peer | null>(null)
  const [receiverId, setReceiverId] = useState<string>("")
  const [message, setMessage] = useState<string>("")
  const [transferProgress, setTransferProgress] = useState<number>(0)
  const [connectionStatus, setConnectionStatus] = useState<string>("Disconnected")
  const [activeConnection, setActiveConnection] = useState<DataConnection | null>(null)
  const [debug, setDebug] = useState<string[]>([])
  const lastChunkTime = useRef<number>(0)
  const fileMetadataRef = useRef<FileMetadata | null>(null)
  const receivedChunksRef = useRef<Map<number, Uint8Array>>(new Map())
  const receivedSizeRef = useRef<number>(0)
  const [chatMessages, setChatMessages] = useState<{ sender: string; message: string }[]>([])
  const [transferHistory, setTransferHistory] = useState<TransferRecord[]>([])
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [fileAnnotations, setFileAnnotations] = useState<{ [fileName: string]: string }>({})
  const [isDarkMode, setIsDarkMode] = useState(false)

  const addDebugMessage = useCallback((msg: string) => {
    setDebug((prev) => [...prev, `${new Date().toISOString()}: ${msg}`])
  }, [])

  const saveTransferRecord = useCallback((record: TransferRecord) => {
    setTransferHistory((prev) => {
      const newHistory = [...prev, record]
      localStorage.setItem("transferHistory", JSON.stringify(newHistory))
      return newHistory
    })
  }, [])

  const assembleAndDownloadFile = useCallback(() => {
    if (fileMetadataRef.current) {
      const sortedChunks = Array.from(receivedChunksRef.current.entries())
        .sort(([a], [b]) => a - b)
        .map(([, chunk]) => chunk)

      const fileData = new Uint8Array(fileMetadataRef.current.size)
      let offset = 0
      for (const chunk of sortedChunks) {
        fileData.set(chunk, offset)
        offset += chunk.length
      }

      const blob = new Blob([fileData], { type: fileMetadataRef.current.type })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = fileMetadataRef.current.name
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      setMessage(`File received and downloaded: ${fileMetadataRef.current.name}`)
      addDebugMessage(`File transfer complete: ${fileMetadataRef.current.name}`)
      saveTransferRecord({
        id: `${Date.now()}-${fileMetadataRef.current.name}`,
        fileName: fileMetadataRef.current.name,
        fileType: fileMetadataRef.current.type,
        fileSize: fileMetadataRef.current.size,
        timestamp: Date.now(),
        direction: "received",
      })
      fileMetadataRef.current = null
      receivedChunksRef.current.clear()
      receivedSizeRef.current = 0
      setTransferProgress(0)
    }
  }, [addDebugMessage, saveTransferRecord])

  const handleConnection = useCallback(
    (conn: DataConnection) => {
      setConnectionStatus("Connected")
      setActiveConnection(conn)
      setMessage("Connected to peer: " + conn.peer)
      addDebugMessage(`Connected to peer: ${conn.peer}`)

      conn.on("data", (data: any) => {
        lastChunkTime.current = Date.now()
        if (data && typeof data === "object" && "metadata" in data) {
          fileMetadataRef.current = data.metadata as FileMetadata
          receivedChunksRef.current.clear()
          receivedSizeRef.current = 0
          setMessage(`Receiving file: ${fileMetadataRef.current.name}`)
          setTransferProgress(0)
          addDebugMessage(`Starting to receive file: ${fileMetadataRef.current.name}`)
        } else if (data && typeof data === "object" && "index" in data && "data" in data) {
          const chunk = data as FileChunk & { isLastChunk?: boolean }

          // Validate chunk data and handle array buffer data
          const chunkData = chunk.data instanceof Uint8Array ? chunk.data : new Uint8Array(chunk.data)
          if (!chunkData || chunkData.length === 0) {
            addDebugMessage(`Invalid chunk received at index ${chunk.index}`)
            return
          }

          receivedChunksRef.current.set(chunk.index, chunkData)
          receivedSizeRef.current += chunkData.length

          if (fileMetadataRef.current) {
            const progress = (receivedChunksRef.current.size / fileMetadataRef.current.totalChunks) * 100
            setTransferProgress(progress)
            addDebugMessage(
              `Received chunk ${chunk.index}: ${chunkData.length} bytes, Progress: ${progress.toFixed(2)}%`,
            )

            // Check if we have received all chunks
            if (receivedChunksRef.current.size === fileMetadataRef.current.totalChunks) {
              assembleAndDownloadFile()
            }
          }
        } else if (typeof data === "string") {
          try {
            const parsedData = JSON.parse(data)
            if (parsedData.type === "chat") {
              setChatMessages((prev) => [...prev, { sender: conn.peer, message: parsedData.message }])
            }
          } catch (e) {
            setMessage(data)
            addDebugMessage(`Received message: ${data}`)
          }
        }
      })

      conn.on("close", () => {
        setConnectionStatus("Disconnected")
        setActiveConnection(null)
        setMessage("Connection closed")
        addDebugMessage("Connection closed")
      })
    },
    [addDebugMessage, assembleAndDownloadFile],
  )

  useEffect(() => {
    const newPeer = new Peer({
      config: {
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:global.stun.twilio.com:3478" },
          { urls: "turn:numb.viagenie.ca", username: "webrtc@live.com", credential: "muazkh" },
        ],
      },
    })

    newPeer.on("open", (id) => {
      setPeerId(id)
      setPeer(newPeer)
      setMessage("Peer created. Your ID: " + id)
      addDebugMessage(`Peer created with ID: ${id}`)
    })

    newPeer.on("connection", handleConnection)

    newPeer.on("error", (err) => {
      addDebugMessage(`Peer error: ${err.message}`)
      setMessage(`Error: ${err.message}`)
    })

    return () => {
      newPeer.destroy()
    }
  }, [addDebugMessage, handleConnection])

  const connectToPeer = useCallback(() => {
    if (peer && receiverId) {
      addDebugMessage(`Attempting to connect to peer: ${receiverId}`)
      const conn = peer.connect(receiverId, {
        reliable: true,
        serialization: "binary",
      })
      conn.on("open", () => {
        handleConnection(conn)
      })
      conn.on("error", (err) => {
        addDebugMessage(`Connection error: ${err.message}`)
        setMessage(`Connection error: ${err.message}`)
      })
    }
  }, [peer, receiverId, handleConnection, addDebugMessage])

  const sendMessage = useCallback(
    (message: string) => {
      if (activeConnection) {
        activeConnection.send(JSON.stringify({ type: "chat", message }))
        setChatMessages((prev) => [...prev, { sender: "You", message }])
      }
    },
    [activeConnection],
  )

  const sendFile = useCallback(
    (file: File) => {
      if (activeConnection) {
        const chunkSize = 16384 // 16KB chunks
        const totalChunks = Math.ceil(file.size / chunkSize)
        const maxConcurrentChunks = 5 // Adjust based on network conditions

        addDebugMessage(`Starting to send file: ${file.name}`)
        activeConnection.send({
          metadata: {
            name: file.name,
            type: file.type,
            size: file.size,
            totalChunks: totalChunks,
          },
        })

        let sentChunks = 0
        let activeTransfers = 0

        const sendChunk = (chunkIndex: number) => {
          const offset = chunkIndex * chunkSize
          const currentChunkSize = Math.min(chunkSize, file.size - offset)
          const slice = file.slice(offset, offset + currentChunkSize)
          const reader = new FileReader()

          reader.onload = (e) => {
            if (e.target?.result instanceof ArrayBuffer) {
              const chunk = new Uint8Array(e.target.result)
              activeConnection.send({
                index: chunkIndex,
                data: chunk,
                isLastChunk: offset + currentChunkSize >= file.size,
              })
              sentChunks++
              activeTransfers--

              const progress = Math.min((sentChunks / totalChunks) * 100, 100)
              setTransferProgress(progress)
              addDebugMessage(`Sent chunk ${chunkIndex}: ${chunk.length} bytes, Progress: ${progress.toFixed(2)}%`)

              if (sentChunks < totalChunks) {
                sendNextChunk()
              } else if (activeTransfers === 0) {
                setMessage("File sent successfully")
                setTransferProgress(0)
                addDebugMessage(`File transfer complete: ${file.name}`)
                saveTransferRecord({
                  id: `${Date.now()}-${file.name}`,
                  fileName: file.name,
                  fileType: file.type,
                  fileSize: file.size,
                  timestamp: Date.now(),
                  direction: "sent",
                })
              }
            }
          }

          reader.onerror = (error) => {
            console.error("Error reading file chunk:", error)
            addDebugMessage(`Error reading file chunk ${chunkIndex}: ${error}`)
            activeTransfers--
            sendNextChunk() // Retry on error
          }

          reader.readAsArrayBuffer(slice)
        }

        const sendNextChunk = () => {
          while (activeTransfers < maxConcurrentChunks && sentChunks + activeTransfers < totalChunks) {
            activeTransfers++
            sendChunk(sentChunks + activeTransfers - 1)
          }
        }

        sendNextChunk()
      } else {
        setMessage("No active connection")
        addDebugMessage("Attempted to send file without active connection")
      }
    },
    [activeConnection, addDebugMessage, saveTransferRecord],
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (acceptedFiles) => {
      if (activeConnection) {
        acceptedFiles.forEach((file) => {
          sendFile(file)
        })
      } else {
        setMessage("Please connect to a peer before sending files")
        addDebugMessage("Attempted to drop files without active connection")
      }
    },
  })

  useEffect(() => {
    const checkTransferStatus = setInterval(() => {
      if (transferProgress > 0 && transferProgress < 100) {
        const timeSinceLastChunk = Date.now() - lastChunkTime.current
        if (timeSinceLastChunk > 10000) {
          // 10 seconds
          addDebugMessage(`Transfer stalled. Last chunk received ${timeSinceLastChunk}ms ago.`)
          setMessage("Transfer stalled. Please try again.")
          setTransferProgress(0)
          // Attempt to restart the transfer
          if (activeConnection && fileMetadataRef.current) {
            addDebugMessage("Attempting to restart transfer...")
            activeConnection.send({
              metadata: fileMetadataRef.current,
              restart: true,
              receivedSize: receivedSizeRef.current,
            })
          }
        }
      }
    }, 5000)

    return () => clearInterval(checkTransferStatus)
  }, [transferProgress, addDebugMessage, activeConnection])

  useEffect(() => {
    const savedHistory = localStorage.getItem("transferHistory")
    if (savedHistory) {
      setTransferHistory(JSON.parse(savedHistory))
    }
  }, [])

  const handleFileSelect = (file: File) => {
    setSelectedFile(file)
  }

  const handleAnnotationSave = (fileName: string, annotation: string) => {
    setFileAnnotations((prev) => {
      const newAnnotations = { ...prev, [fileName]: annotation }
      localStorage.setItem("fileAnnotations", JSON.stringify(newAnnotations))
      return newAnnotations
    })
  }

  useEffect(() => {
    const savedAnnotations = localStorage.getItem("fileAnnotations")
    if (savedAnnotations) {
      setFileAnnotations(JSON.parse(savedAnnotations))
    }
  }, [])

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(
      () => {
        setMessage("Copied to clipboard!")
      },
      (err) => {
        console.error("Could not copy text: ", err)
      },
    )
  }

  const toggleDarkMode = () => {
    setIsDarkMode(!isDarkMode)
    document.documentElement.classList.toggle("dark")
  }

  useEffect(() => {
    const savedMode = localStorage.getItem("darkMode")
    if (savedMode === "true") {
      setIsDarkMode(true)
      document.documentElement.classList.add("dark")
    }
  }, [])

  useEffect(() => {
    localStorage.setItem("darkMode", isDarkMode.toString())
  }, [isDarkMode])

  return (
    <main
      className={`flex min-h-screen flex-col items-center justify-between p-4 md:p-24 ${isDarkMode ? "dark bg-gray-900" : "bg-gray-100"}`}
    >
      <div className="z-10 w-full max-w-5xl items-center justify-between font-mono text-sm">
        <Card className="w-full mb-8">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>P2P File Sharing</CardTitle>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center space-x-2">
                    <Switch id="dark-mode" checked={isDarkMode} onCheckedChange={toggleDarkMode} />
                    <Label htmlFor="dark-mode">
                      {isDarkMode ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
                    </Label>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Toggle dark mode</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="connect" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="connect">Connect</TabsTrigger>
                <TabsTrigger value="share">Share Files</TabsTrigger>
              </TabsList>
              <TabsContent value="connect">
                <div className="space-y-4">
                  <div>
                    <h2 className="text-lg font-semibold mb-2">Your ID:</h2>
                    <div className="flex items-center space-x-2">
                      <Input value={peerId} readOnly />
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button onClick={() => copyToClipboard(peerId)} variant="outline" size="icon">
                              <Copy className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Copy your ID</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    {peerId && (
                      <div className="mt-4 flex justify-center">
                        <QRCodeSVG value={peerId} size={200} />
                      </div>
                    )}
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold mb-2">Connect to Peer:</h2>
                    <div className="flex items-center space-x-2">
                      <Input
                        value={receiverId}
                        onChange={(e) => setReceiverId(e.target.value)}
                        placeholder="Enter receiver's ID"
                      />
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button onClick={connectToPeer} disabled={!receiverId}>
                              <Link className="mr-2 h-4 w-4" />
                              Connect
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Connect to peer</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </div>
                  <Alert variant={connectionStatus === "Connected" ? "default" : "destructive"}>
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Connection Status</AlertTitle>
                    <AlertDescription>{connectionStatus}</AlertDescription>
                  </Alert>
                  {message && (
                    <Alert>
                      <AlertDescription>{message}</AlertDescription>
                    </Alert>
                  )}
                </div>
              </TabsContent>
              <TabsContent value="share">
                <div
                  {...getRootProps()}
                  className={`border-2 border-dashed rounded-md p-8 text-center cursor-pointer transition-colors ${
                    isDragActive ? "border-primary" : "border-muted-foreground"
                  }`}
                >
                  <input {...getInputProps()} />
                  <Upload className="mx-auto h-12 w-12 text-muted-foreground" />
                  <p className="mt-2">Drag 'n' drop some files here, or click to select files</p>
                </div>
                {transferProgress > 0 && (
                  <div className="mt-4">
                    <Progress value={transferProgress} className="w-full" />
                    <p className="text-sm text-center mt-2">{transferProgress.toFixed(2)}% Complete</p>
                  </div>
                )}
                {selectedFile && (
                  <div className="mt-4">
                    <h3 className="text-lg font-semibold mb-2">Selected File:</h3>
                    <div className="flex items-center space-x-2">
                      <File className="h-6 w-6" />
                      <span>{selectedFile.name}</span>
                    </div>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <Card>
            <CardHeader>
              <CardTitle>Chat</CardTitle>
            </CardHeader>
            <CardContent>
              <Chat messages={chatMessages} onSendMessage={sendMessage} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Transfer History</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[300px]">
                <TransferHistory history={transferHistory} />
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {selectedFile && (
          <Card className="mt-8">
            <CardHeader>
              <CardTitle>File Annotation</CardTitle>
            </CardHeader>
            <CardContent>
              <FileAnnotation
                file={selectedFile}
                annotation={fileAnnotations[selectedFile.name] || ""}
                onSave={handleAnnotationSave}
              />
            </CardContent>
          </Card>
        )}

        {/* Debug log is commented out but still functional in the background */}
        {/* <Card className="mt-8">
          <CardHeader>
            <CardTitle>Debug Log</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[200px]">
              <pre className="text-xs">{debug.join("\n")}</pre>
            </ScrollArea>
          </CardContent>
        </Card> */}
      </div>
    </main>
  )
}

