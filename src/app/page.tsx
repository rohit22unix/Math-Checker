"use client";

import type { ChangeEvent } from "react";
import { useEffect, useState } from "react";

export default function Home() {
  const [worksheet, setWorksheet] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [status, setStatus] = useState("Waiting for a worksheet photo.");
  const [inputVersion, setInputVersion] = useState(0);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  function handleImageSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.item(0);

    if (!file) {
      setStatus("No photo was returned by the browser.");
      return;
    }

    setStatus(`Photo received: ${file.name || "camera-photo"}`);

    if (!file.type.startsWith("image/")) {
      setStatus(`Unsupported file type: ${file.type || "unknown"}`);
      return;
    }

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    const newPreviewUrl = URL.createObjectURL(file);

    setWorksheet(file);
    setPreviewUrl(newPreviewUrl);
    setStatus("Photo received. Loading preview…");
  }

  function handlePreviewLoaded() {
    setStatus("Worksheet photo is ready.");
  }

  function handlePreviewError() {
    setStatus(
      "The browser received the photo but could not display its format."
    );
  }

  function removeWorksheet() {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    setWorksheet(null);
    setPreviewUrl("");
    setStatus("Waiting for a worksheet photo.");
    setInputVersion((current) => current + 1);
  }

  function checkWorksheet() {
    if (!worksheet) {
      setStatus("Please select or photograph a worksheet first.");
      return;
    }

    alert(
      "Worksheet selected successfully. AI checking will be added next."
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-md">
        <header className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600 text-3xl shadow-lg">
            🧮
          </div>

          <h1 className="text-3xl font-bold">Math-Checker</h1>

          <p className="mt-2 text-sm leading-6 text-slate-600">
            Photograph your completed worksheet and check your answers.
          </p>

          <p className="mt-2 text-xs font-semibold text-blue-600">
            Mobile upload test: Version 4
          </p>
        </header>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          {!previewUrl ? (
            <div>
              <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center">
                <div className="mb-3 text-5xl">📄</div>

                <h2 className="text-lg font-semibold">Add a worksheet</h2>

                <p className="mt-2 text-sm text-slate-500">
                  Use one of the native photo controls below.
                </p>
              </div>

              <div className="mt-5">
                <label
                  htmlFor={`camera-${inputVersion}`}
                  className="mb-2 block font-semibold"
                >
                  📷 Take Worksheet Photo
                </label>

                <input
                  key={`camera-${inputVersion}`}
                  id={`camera-${inputVersion}`}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleImageSelected}
                  className="block w-full rounded-xl border border-slate-300 bg-white p-3 text-sm
                    file:mr-3 file:rounded-lg file:border-0 file:bg-blue-600
                    file:px-4 file:py-2 file:font-semibold file:text-white"
                />
              </div>

              <div className="mt-5">
                <label
                  htmlFor={`gallery-${inputVersion}`}
                  className="mb-2 block font-semibold"
                >
                  🖼️ Choose From Photos
                </label>

                <input
                  key={`gallery-${inputVersion}`}
                  id={`gallery-${inputVersion}`}
                  type="file"
                  accept="image/*"
                  onChange={handleImageSelected}
                  className="block w-full rounded-xl border border-slate-300 bg-white p-3 text-sm
                    file:mr-3 file:rounded-lg file:border-0 file:bg-slate-700
                    file:px-4 file:py-2 file:font-semibold file:text-white"
                />
              </div>
            </div>
          ) : (
            <div>
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewUrl}
                  alt="Selected worksheet preview"
                  onLoad={handlePreviewLoaded}
                  onError={handlePreviewError}
                  className="max-h-[520px] w-full object-contain"
                />
              </div>

              <p className="mt-3 truncate text-center text-xs text-slate-500">
                {worksheet?.name || "Worksheet photo"}
              </p>

              <button
                type="button"
                onClick={removeWorksheet}
                className="mt-5 w-full rounded-xl border border-red-200 px-4 py-3 font-semibold text-red-600"
              >
                Remove and Select Another
              </button>

              <button
                type="button"
                onClick={checkWorksheet}
                className="mt-3 w-full rounded-xl bg-emerald-600 px-4 py-4 text-lg font-bold text-white"
              >
                Check My Work
              </button>
            </div>
          )}

          <div
            role="status"
            className="mt-5 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm font-medium text-blue-800"
          >
            Status: {status}
          </div>
        </section>
      </div>
    </main>
  );
}