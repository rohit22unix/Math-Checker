"use client";

import type { ChangeEvent } from "react";
import { useEffect, useState } from "react";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_IMAGE_EDGE = 640;
const AGGRESSIVE_MAX_IMAGE_EDGE = 520;
const OPTIMIZED_UPLOAD_BYTES = 1.5 * 1024 * 1024;
const ANALYSIS_TIMEOUT_MS = 130_000;
const SECTION_ANALYSIS_TIMEOUT_MS = 120_000;
const UNUSABLE_RESULT_MARKER =
  "the worksheet image was received, but the local model did not return a usable result";
const SERVER_GRADING_MARKER = "Graded by Math-Checker (server-side)";

type WorksheetApiResult = {
  analysis?: string;
  error?: string;
  durationMs?: number;
  gradingVersion?: string;
};

function renameAsJpeg(fileName: string) {
  const trimmedName = fileName.trim();
  const extensionIndex = trimmedName.lastIndexOf(".");

  if (extensionIndex === -1) {
    return `${trimmedName || "worksheet"}.jpg`;
  }

  return `${trimmedName.slice(0, extensionIndex) || "worksheet"}.jpg`;
}

async function optimizeWorksheetImage(file: File): Promise<File> {
  return optimizeWorksheetImageWithSettings(file, MAX_IMAGE_EDGE, 0.68);
}

async function optimizeWorksheetImageAggressive(file: File): Promise<File> {
  return optimizeWorksheetImageWithSettings(file, AGGRESSIVE_MAX_IMAGE_EDGE, 0.62);
}

async function optimizeWorksheetImageWithSettings(
  file: File,
  maxEdge: number,
  jpegQuality: number
): Promise<File> {

  const previewObjectUrl = URL.createObjectURL(file);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();

      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("The selected image could not be read."));
      element.src = previewObjectUrl;
    });

    const longestEdge = Math.max(image.width, image.height);

    if (longestEdge <= maxEdge && file.size <= OPTIMIZED_UPLOAD_BYTES) {
      return file;
    }

    const scale = Math.min(1, maxEdge / longestEdge);
    const canvas = document.createElement("canvas");

    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));

    const context = canvas.getContext("2d");

    if (!context) {
      return file;
    }

    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", jpegQuality);
    });

    if (!blob) {
      return file;
    }

    const needsDownscale = longestEdge > maxEdge;

    if (!needsDownscale && blob.size >= file.size) {
      return file;
    }

    return new File([blob], renameAsJpeg(file.name), {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } finally {
    URL.revokeObjectURL(previewObjectUrl);
  }
}

function isUnusableAnalysisResult(text: string) {
  return text.toLowerCase().includes(UNUSABLE_RESULT_MARKER);
}

async function requestWorksheetAnalysis(
  file: File,
  timeoutMs: number
): Promise<{ ok: boolean; data: WorksheetApiResult; timedOut: boolean }> {
  const formData = new FormData();
  formData.append("worksheet", file);

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    try {
      const response = await fetch("/api/check-worksheet", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      const payload = (await response.json()) as WorksheetApiResult;

      return {
        ok: response.ok,
        data: payload,
        timedOut: false,
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return {
          ok: false,
          data: { error: "REQUEST_TIMEOUT" },
          timedOut: true,
        };
      }

      throw error;
    }
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function createWorksheetSections(file: File): Promise<File[]> {
  const previewObjectUrl = URL.createObjectURL(file);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();

      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("The selected image could not be read."));
      element.src = previewObjectUrl;
    });

    const width = image.width;
    const height = image.height;

    if (width < 400 || height < 400) {
      return [file];
    }

    const splitX = Math.floor(width / 2);
    const splitY = Math.floor(height / 2);
    const regions = [
      { x: 0, y: 0, w: splitX, h: splitY },
      { x: splitX, y: 0, w: width - splitX, h: splitY },
      { x: 0, y: splitY, w: splitX, h: height - splitY },
      { x: splitX, y: splitY, w: width - splitX, h: height - splitY },
    ];

    const files: File[] = [];

    for (let index = 0; index < regions.length; index += 1) {
      const region = regions[index];
      const canvas = document.createElement("canvas");

      canvas.width = region.w;
      canvas.height = region.h;

      const context = canvas.getContext("2d");

      if (!context) {
        continue;
      }

      context.drawImage(
        image,
        region.x,
        region.y,
        region.w,
        region.h,
        0,
        0,
        region.w,
        region.h
      );

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, "image/jpeg", 0.75);
      });

      if (!blob) {
        continue;
      }

      files.push(
        new File([blob], `${renameAsJpeg(file.name).replace(/\.jpg$/i, "")}-section-${index + 1}.jpg`, {
          type: "image/jpeg",
          lastModified: Date.now(),
        })
      );
    }

    return files.length ? files : [file];
  } finally {
    URL.revokeObjectURL(previewObjectUrl);
  }
}

export default function Home() {
  const [worksheet, setWorksheet] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewName, setPreviewName] = useState("");
  const [statusMessage, setStatusMessage] = useState(
    "Upload a worksheet photo to get started."
  );
  const [analysisReport, setAnalysisReport] = useState("");
  const [analysisDuration, setAnalysisDuration] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [isChecking, setIsChecking] = useState(false);
  const [inputVersion, setInputVersion] = useState(0);
  const [appVersion, setAppVersion] = useState("checking...");
  const [modelStatus, setModelStatus] = useState("starting");
  const [ollamaProcessor, setOllamaProcessor] = useState("unknown");

  useEffect(() => {
    fetch("/api/version")
      .then((response) => response.json())
      .then((payload: { grading?: string }) => {
        setAppVersion(payload.grading || "unknown");
      })
      .catch(() => {
        setAppVersion("unknown");
      });

    fetch("/api/warmup", { method: "POST" })
      .then(async (response) => {
        const payload = (await response.json()) as {
          processor?: string;
          error?: string;
        };

        if (!response.ok) {
          setModelStatus("offline");
          setOllamaProcessor("offline");
          return;
        }

        setModelStatus("ready");
        setOllamaProcessor(payload.processor || "unknown");
      })
      .catch(() => {
        setModelStatus("offline");
        setOllamaProcessor("offline");
      });
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  async function handleImageSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.item(0);

    if (!file) {
      setErrorMessage("No image was returned by the browser.");
      setStatusMessage("Please try selecting the photo again.");
      return;
    }

    if (!file.type.startsWith("image/")) {
      setErrorMessage("Please choose a valid image file.");
      setStatusMessage("Only image files are supported.");
      return;
    }

    if (file.size === 0) {
      setErrorMessage("The selected image is empty.");
      setStatusMessage("Choose a photo with visible worksheet content.");
      return;
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      setErrorMessage("Please choose an image smaller than 25 MB.");
      setStatusMessage("A smaller image will be faster to analyze.");
      return;
    }

    setStatusMessage("Preparing worksheet photo for local analysis...");

    let optimizedFile = file;
    let optimizationFailed = false;

    try {
      optimizedFile = await optimizeWorksheetImage(file);
    } catch {
      optimizationFailed = true;
      setErrorMessage(
        "We could not optimize this photo, so the original image will be uploaded instead."
      );
      setStatusMessage("Worksheet ready. Tap Check My Work to start local analysis.");
    }

    if (optimizedFile.size > MAX_UPLOAD_BYTES) {
      setErrorMessage("Please choose an image smaller than 25 MB.");
      setStatusMessage("A smaller image will be faster to analyze.");
      return;
    }

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    const newPreviewUrl = URL.createObjectURL(file);

    setWorksheet(optimizedFile);
    setPreviewName(file.name || "Worksheet photo");
    setPreviewUrl(newPreviewUrl);
    if (!optimizationFailed) {
      setErrorMessage("");
    }
    setAnalysisReport("");
    setAnalysisDuration(null);
    setStatusMessage("Worksheet ready. Tap Check My Work to start local analysis.");
  }

  function handlePreviewLoaded() {
    setStatusMessage("Worksheet preview is ready.");
  }

  function handlePreviewError() {
    setErrorMessage("The browser could not display the selected image.");
  }

  function removeWorksheet() {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    setWorksheet(null);
    setPreviewUrl("");
    setPreviewName("");
    setStatusMessage("Upload a worksheet photo to get started.");
    setAnalysisReport("");
    setAnalysisDuration(null);
    setErrorMessage("");
    setInputVersion((current) => current + 1);
  }

  async function checkWorksheet() {
    if (!worksheet) {
      setErrorMessage("Please select or photograph a worksheet first.");
      return;
    }

    if (isChecking) {
      return;
    }

    setIsChecking(true);
    setErrorMessage("");
    setAnalysisReport("");
    setAnalysisDuration(null);
    setStatusMessage(
      ollamaProcessor === "gpu"
        ? "Checking Worksheet… GPU analysis usually takes 8–20 seconds."
        : "Checking Worksheet… CPU analysis usually takes 30–90 seconds."
    );

    const startedAt = Date.now();

    try {
      let requestFile = worksheet;
      let didRetryForContext = false;
      let payload: WorksheetApiResult | null = null;

      while (true) {
        const result = await requestWorksheetAnalysis(requestFile, ANALYSIS_TIMEOUT_MS);

        if (result.timedOut) {
          payload = {
            analysis:
              "The full-page worksheet request timed out. Trying section-by-section analysis now.",
          };
          break;
        }

        payload = result.data;

        if (result.ok) {
          break;
        }

        const message = String(payload?.error || "");
        const isContextProblem =
          message.toLowerCase().includes("processing space") ||
          message.toLowerCase().includes("context size");
        const isServerTimeout = message.toLowerCase().includes("timed out");

        if (isContextProblem && !didRetryForContext) {
          didRetryForContext = true;
          requestFile = await optimizeWorksheetImageAggressive(worksheet);
          setStatusMessage("Retrying with a smaller worksheet image for local AI analysis...");
          continue;
        }

        if (isServerTimeout) {
          payload = {
            analysis:
              "The full-page worksheet request timed out. Trying section-by-section analysis now.",
          };
          break;
        }

        throw new Error(message || "The server could not process the worksheet.");
      }

      const analysisText = String(payload?.analysis || "").trim();
      const shouldTrySections =
        (analysisText && isUnusableAnalysisResult(analysisText)) ||
        analysisText.startsWith("The full-page worksheet request timed out");

      if (shouldTrySections) {
        setStatusMessage("Trying section-by-section worksheet analysis...");

        const sectionFiles = await createWorksheetSections(worksheet);
        const sectionReports: string[] = [];
        const sectionOutcomes: string[] = [];

        for (let index = 0; index < sectionFiles.length; index += 1) {
          const sectionResult = await requestWorksheetAnalysis(
            sectionFiles[index],
            SECTION_ANALYSIS_TIMEOUT_MS
          );

          if (sectionResult.timedOut) {
            sectionOutcomes.push(`Section ${index + 1}: timed out`);
            continue;
          }

          if (!sectionResult.ok) {
            const sectionError = String(sectionResult.data.error || "request failed");
            sectionOutcomes.push(`Section ${index + 1}: ${sectionError}`);
            continue;
          }

          const sectionText = String(sectionResult.data.analysis || "").trim();

          if (!sectionText || isUnusableAnalysisResult(sectionText)) {
            sectionOutcomes.push(`Section ${index + 1}: no usable text extracted`);
            continue;
          }

          sectionOutcomes.push(`Section ${index + 1}: extracted`);
          sectionReports.push(`Section ${index + 1}: ${sectionText}`);
        }

        if (sectionReports.length > 0) {
          payload.analysis =
            "Combined section-by-section analysis:\n\n" + sectionReports.join("\n\n");
        } else {
          payload.analysis =
            "Section-by-section analysis could not extract readable worksheet text.\n\n" +
            sectionOutcomes.join("\n") +
            "\n\nTry taking two separate photos: one for the top half and one for the bottom half.";
        }
      }

      setAnalysisDuration(payload.durationMs ?? Date.now() - startedAt);
      const report = payload.analysis || "No worksheet analysis was returned.";
      setAnalysisReport(report);

      if (
        payload.gradingVersion !== "server-side-v2" &&
        !report.includes(SERVER_GRADING_MARKER)
      ) {
        setErrorMessage(
          "This report looks like an older app build. On your laptop run: git pull origin master && npm install && npm run build && npm run start -- --hostname 0.0.0.0"
        );
      }

      setStatusMessage("Worksheet analysis complete.");
    } catch (error) {
      if (
        (error instanceof Error && error.name === "AbortError") ||
        (error instanceof Error && error.message === "REQUEST_TIMEOUT")
      ) {
        setErrorMessage(
          "The local analysis took too long. Try a smaller, clearer photo or a worksheet with fewer questions."
        );
        setStatusMessage("Analysis timed out. Please try again with a simpler photo.");
      } else {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Unable to contact the local analysis service."
        );
        setStatusMessage("Analysis was not completed. Please try again.");
      }
    } finally {
      setIsChecking(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 lg:flex-row">
        <section className="w-full rounded-3xl border border-slate-200 bg-white p-5 shadow-sm lg:max-w-md">
          <header className="mb-6 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600 text-3xl shadow-lg">
              🧮
            </div>

            <h1 className="text-3xl font-bold">Math-Checker</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Snap a photo of a completed worksheet and get a simple local image analysis.
            </p>
          </header>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            <p className="font-semibold text-slate-800">Photo tips</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Use good lighting and keep the page flat.</li>
                <li>Avoid strong shadows from your phone or your hand.</li>
              <li>Crop close to the worked problems so the fractions stay readable.</li>
              <li>Write final answers clearly; a messy 4 can be misread as 9.</li>
              <li>Photos are processed locally and are not permanently stored.</li>
            </ul>
          </div>

          {!previewUrl ? (
            <div className="mt-5 space-y-5">
              <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center">
                <div className="mb-3 text-5xl">📄</div>
                <h2 className="text-lg font-semibold">Add a worksheet</h2>
                <p className="mt-2 text-sm text-slate-500">
                  Pick a photo from your camera or your photo library for a quick local analysis.
                </p>
              </div>

              <div>
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
                  className="block w-full rounded-xl border border-slate-300 bg-white p-3 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-blue-600 file:px-4 file:py-2 file:font-semibold file:text-white"
                />
              </div>

              <div>
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
                  className="block w-full rounded-xl border border-slate-300 bg-white p-3 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-700 file:px-4 file:py-2 file:font-semibold file:text-white"
                />
              </div>
            </div>
          ) : (
            <div className="mt-5 space-y-4">
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

              <p className="truncate text-center text-xs text-slate-500">
                {previewName || "Worksheet photo"}
              </p>

              <button
                type="button"
                onClick={removeWorksheet}
                className="w-full rounded-xl border border-red-200 px-4 py-3 font-semibold text-red-600"
              >
                Remove and Select Another
              </button>

              <button
                type="button"
                onClick={checkWorksheet}
                disabled={isChecking}
                className="w-full rounded-xl bg-emerald-600 px-4 py-4 text-lg font-bold text-white disabled:cursor-not-allowed disabled:bg-emerald-400"
              >
                {isChecking ? "Checking Worksheet…" : "Check My Work"}
              </button>
            </div>
          )}

          <div className="mt-5 rounded-2xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
            {isChecking ? (
              <div className="flex items-center gap-3">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
                <span>{statusMessage}</span>
              </div>
            ) : (
              <p>{statusMessage}</p>
            )}
          </div>

          {errorMessage ? (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {errorMessage}
            </div>
          ) : null}
        </section>

        <section className="flex-1 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-semibold">Worksheet Report</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            The analysis is generated locally with Ollama and shown here once it finishes. For best results, use a clear, well-lit photo of one worksheet page.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            App grading engine: {appVersion} · Ollama: {modelStatus}
            {modelStatus === "ready" ? ` · Processor: ${ollamaProcessor}` : null}
          </p>

          {modelStatus === "ready" &&
          (ollamaProcessor === "cpu" || ollamaProcessor.startsWith("hybrid")) ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-semibold">Ollama is running on CPU — analysis takes ~30–90 seconds.</p>
              <p className="mt-2 leading-6">
                For ~8–20 second checks, use a GPU via a home PC or rent one by the hour (RunPod,
                Vast.ai). Point this app at remote Ollama in{" "}
                <code className="rounded bg-amber-100 px-1">.env.local</code>:
              </p>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-amber-100/70 p-3 text-xs leading-5">
                {`# RunPod example:
OLLAMA_URL=https://xxxxxxxx-11434.proxy.runpod.net
OLLAMA_MODEL=qwen3-vl:2b-instruct
OLLAMA_FAST_MODE=true`}
              </pre>
              <p className="mt-2 text-xs leading-5 text-amber-800">
                Stop the cloud pod when you finish to keep cost low (~$0.04–0.11 per short session).
                See README for RunPod setup and SSH tunnel options.
              </p>
            </div>
          ) : null}

          {modelStatus === "ready" && ollamaProcessor === "gpu" ? (
            <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              Ollama is using your GPU — worksheet analysis should finish in about 8–20 seconds.
            </div>
          ) : null}

          {analysisReport ? (
            <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-emerald-800">Complete report</p>
                {analysisDuration !== null ? (
                  <span className="text-xs font-medium text-emerald-700">
                    {Math.round(analysisDuration / 1000)}s
                  </span>
                ) : null}
              </div>
              <div className="whitespace-pre-wrap text-sm leading-7 text-slate-700">
                {analysisReport}
              </div>
            </div>
          ) : (
            <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
              Results appear here after you choose a worksheet and press Check My Work.
            </div>
          )}
        </section>
      </div>
    </main>
  );
}