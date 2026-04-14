"use client";

import { uploadToS3 } from "@/lib/s3";
import { Inbox, Loader2 } from "lucide-react";
import React from "react";
import { useDropzone } from "react-dropzone";
import { useMutation } from "@tanstack/react-query";
import axios from "axios";
import toast from "react-hot-toast";
import { useRouter } from "next/navigation";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function FileUpload() {
  const router = useRouter();
  const [uploading, setUploading] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [fileName, setFileName] = React.useState<string | null>(null);
  const inFlightRef = React.useRef(false);

  const { mutateAsync, isPending } = useMutation({
    mutationFn: async (variables: { file_key: string; file_name: string }) => {
      const response = await axios.post("/api/create-chat", variables, {
        timeout: 120000,
      });
      return response.data as {
        chatId?: number;
        indexingStatus?: "processing" | "already_exists";
        namespace: string;
      };
    },
  });

  const isDisabled = uploading || isPending;

  const { getRootProps, getInputProps } = useDropzone({
    accept: { "application/pdf": [".pdf"] },
    maxFiles: 1,

    onDrop: async (acceptedFiles) => {
      if (inFlightRef.current || uploading || isPending) {
        return;
      }

      const file = acceptedFiles[0];
      if (!file) return;

      if (file.size > MAX_UPLOAD_BYTES) {
        toast.error("File size should be less than 10MB ❌");
        return;
      }

      try {
        inFlightRef.current = true;
        setUploading(true);
        setProgress(0);
        setFileName(file.name);

        toast.loading("Uploading...", { id: "upload" });

        const data = await uploadToS3(file, (p: number) => {
          setProgress(p);
        });
        console.log("S3 upload response:", data);

        if (!data?.file_key || !data?.file_name) {
          toast.error("Upload failed ❌", { id: "upload" });
          return;
        }

        const chatResponse = await mutateAsync(data);
        console.log("create-chat response:", chatResponse);
        console.log("uploaded file payload:", data);
        toast.success("File uploaded. Indexing started in background ✅", { id: "upload" });
        if (chatResponse?.chatId) {
          router.push(`/chat/${chatResponse.chatId}`);
        }

      } catch (error) {
        console.error(error);
        if (axios.isAxiosError(error)) {
          const serverMessage = error.response?.data?.error;
          if (typeof serverMessage === "string") {
            toast.error(serverMessage, { id: "upload" });
            return;
          }

          if (error.code === "ECONNABORTED") {
            toast.error("Request timed out. Please try again.", { id: "upload" });
            return;
          }
        }

        toast.error("Something went wrong ❌", { id: "upload" });
      } finally {
        inFlightRef.current = false;
        setUploading(false);
        setTimeout(() => {
          setProgress(0);
          setFileName(null);
        }, 2000);
      }
    },
  });

  return (
    <div className="p-4 bg-white rounded-xl shadow">
      <div
        {...getRootProps({
          className: `border-dashed border-2 rounded-xl cursor-pointer bg-gray-50 py-10 flex justify-center items-center flex-col transition ${
            isDisabled ? "opacity-50 cursor-not-allowed" : "hover:bg-gray-100"
          }`,
        })}
      >
        <input {...getInputProps()} disabled={isDisabled} />

        {/* ICON / LOADER */}
        {uploading ? (
          <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
        ) : (
          <Inbox className="w-10 h-10 text-blue-500" />
        )}

        {/* TEXT */}
        <p className="mt-2 text-sm text-slate-500">
          {uploading ? `Uploading... ${progress}%` : "Drop PDF Here"}
        </p>

        {/* FILE NAME */}
        {fileName && (
          <p className="text-xs text-gray-400 mt-1">{fileName}</p>
        )}

        {/* PROGRESS BAR */}
        {uploading && (
          <div className="w-full max-w-xs bg-gray-200 rounded-full h-2 mt-3">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default FileUpload;