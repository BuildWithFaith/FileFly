import type React from "react"

interface TransferRecord {
  id: string
  fileName: string
  fileType: string
  fileSize: number
  timestamp: number
  direction: "sent" | "received"
}

interface TransferHistoryProps {
  history: TransferRecord[]
}

export const TransferHistory: React.FC<TransferHistoryProps> = ({ history }) => {
  return (
    <div className="mt-8 w-full max-w-md">
      <h2 className="text-2xl mb-4">Transfer History</h2>
      <div className="bg-gray-100 p-4 rounded max-h-60 overflow-auto">
        {history.map((record) => (
          <div key={record.id} className="mb-2">
            <strong>{record.fileName}</strong> ({record.fileSize} bytes)
            <br />
            {record.direction === "sent" ? "Sent" : "Received"} at {new Date(record.timestamp).toLocaleString()}
          </div>
        ))}
      </div>
    </div>
  )
}

