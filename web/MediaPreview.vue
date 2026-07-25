<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { ConversionMode } from "../src/cli";
import { isImageFile } from "./generator";
import { t } from "./i18n";

const FPS = 20;

const props = defineProps<{
    file: File;
    mode: ConversionMode;
    width: number;
    height: number;
    threshold: number;
    orderedDitherAmplitude: number;
    invert: boolean;
}>();
const emit = defineEmits<{
    "source-dimensions": [width: number, height: number];
}>();

const canvas = ref<HTMLCanvasElement>();
const video = ref<HTMLVideoElement>();
const frame = ref(0);
const frameCount = ref(1);
const duration = ref(0);
const loading = ref(true);
const rendering = ref(false);
const downscaled = ref(false);
const ready = ref(false);
const error = ref("");
const videoFile = computed(() => !isImageFile(props.file));
const frameTime = computed(() => Math.min(frame.value / FPS, duration.value));
const frameLabel = computed(() =>
    `${frame.value + 1} / ${frameCount.value} · ${frameTime.value.toFixed(2)}s`,
);

let objectUrl = "";
let bitmap: ImageBitmap | undefined;
let loadGeneration = 0;
let seekGeneration = 0;
let seekTimer: ReturnType<typeof setTimeout> | undefined;
let renderGeneration = 0;
let previewWorker: Worker | undefined;
let cancelWorkerRequest: (() => void) | undefined;
let canvasResizeObserver: ResizeObserver | undefined;

interface PreviewWorkerRequest {
    rgba: Uint8ClampedArray<ArrayBuffer>;
    width: number;
    height: number;
    mode: ConversionMode;
    threshold: number;
    orderedDitherAmplitude: number;
    invert: boolean;
}

interface PreviewWorkerResponse {
    rgba?: Uint8ClampedArray<ArrayBuffer>;
    width?: number;
    height?: number;
    error?: string;
}

type PreviewSource = ImageBitmap | HTMLVideoElement;

function sourceSize(source: PreviewSource): { width: number; height: number } {
    if (source instanceof HTMLVideoElement) {
        return { width: source.videoWidth, height: source.videoHeight };
    }
    return { width: source.width, height: source.height };
}

function sampleRgba(
    source: PreviewSource,
    width: number,
    height: number,
): Uint8ClampedArray<ArrayBuffer> {
    const sampleCanvas = document.createElement("canvas");
    sampleCanvas.width = width;
    sampleCanvas.height = height;
    const context = sampleCanvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("The browser does not provide a 2D canvas context.");
    context.fillStyle = "#000";
    context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    const dimensions = sourceSize(source);
    const scale = Math.min(width / dimensions.width, height / dimensions.height);
    const drawWidth = Math.max(1, Math.round(dimensions.width * scale));
    const drawHeight = Math.max(1, Math.round(dimensions.height * scale));
    context.drawImage(
        source,
        (width - drawWidth) / 2,
        (height - drawHeight) / 2,
        drawWidth,
        drawHeight,
    );
    return context.getImageData(0, 0, width, height).data;
}

function cancelPreviewWorker(): void {
    previewWorker?.terminate();
    previewWorker = undefined;
    cancelWorkerRequest?.();
    cancelWorkerRequest = undefined;
}

function updateCanvasScaling(): void {
    const target = canvas.value;
    if (!target) return;
    downscaled.value = target.width > target.clientWidth || target.height > target.clientHeight;
}

function runPreviewWorker(request: PreviewWorkerRequest): Promise<PreviewWorkerResponse | undefined> {
    cancelPreviewWorker();
    const worker = new Worker(new URL("./preview-worker.ts", import.meta.url), { type: "module" });
    previewWorker = worker;
    return new Promise((resolve, reject) => {
        let settled = false;
        const cleanup = (): void => {
            if (previewWorker === worker) previewWorker = undefined;
            if (cancelWorkerRequest === cancel) cancelWorkerRequest = undefined;
            worker.terminate();
        };
        const cancel = (): void => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(undefined);
        };
        cancelWorkerRequest = cancel;
        worker.addEventListener("message", (event: MessageEvent<PreviewWorkerResponse>) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(event.data);
        }, { once: true });
        worker.addEventListener("error", (event) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(new Error(event.message || "Preview worker failed."));
        }, { once: true });
        worker.postMessage(request, [request.rgba.buffer]);
    });
}

async function drawSource(source: PreviewSource): Promise<void> {
    const target = canvas.value;
    if (!target) return;
    const generation = ++renderGeneration;
    const logicalWidth = props.width;
    const logicalHeight = props.height;
    rendering.value = true;
    error.value = "";
    try {
        const rgba = sampleRgba(source, logicalWidth, logicalHeight);
        const response = await runPreviewWorker({
            rgba,
            width: logicalWidth,
            height: logicalHeight,
            mode: props.mode,
            threshold: props.threshold,
            orderedDitherAmplitude: props.orderedDitherAmplitude,
            invert: props.invert,
        });
        if (!response || generation !== renderGeneration) return;
        if (response.error) throw new Error(response.error);
        if (!response.rgba || !response.width || !response.height) {
            throw new Error("The preview worker returned an incomplete image.");
        }
        target.width = response.width;
        target.height = response.height;
        const context = target.getContext("2d");
        if (!context) throw new Error("The browser does not provide a preview canvas context.");
        context.putImageData(new ImageData(response.rgba, response.width, response.height), 0, 0);
        requestAnimationFrame(updateCanvasScaling);
    } finally {
        if (generation === renderGeneration) rendering.value = false;
    }
}

function waitForVideoEvent(element: HTMLVideoElement, event: "loadedmetadata" | "loadeddata" | "seeked"): Promise<void> {
    return new Promise((resolve, reject) => {
        const cleanup = (): void => {
            element.removeEventListener(event, done);
            element.removeEventListener("error", failed);
        };
        const done = (): void => { cleanup(); resolve(); };
        const failed = (): void => { cleanup(); reject(new Error("Unable to decode the selected video.")); };
        element.addEventListener(event, done, { once: true });
        element.addEventListener("error", failed, { once: true });
    });
}

async function seekFrame(index: number, generation: number): Promise<void> {
    const element = video.value;
    if (!element || !Number.isFinite(duration.value)) return;
    const targetTime = Math.min(index / FPS, Math.max(0, duration.value - 0.001));
    if (Math.abs(element.currentTime - targetTime) > 0.001) {
        const seeked = waitForVideoEvent(element, "seeked");
        element.currentTime = targetTime;
        await seeked;
    }
    if (generation !== seekGeneration) return;
    await drawSource(element);
}

function scheduleFrame(index: number): void {
    if (!ready.value) return;
    clearTimeout(seekTimer);
    const generation = ++seekGeneration;
    seekTimer = setTimeout(() => {
        seekFrame(index, generation).catch((reason) => {
            if (generation === seekGeneration) {
                error.value = reason instanceof Error ? reason.message : String(reason);
            }
        });
    }, 40);
}

async function loadFile(): Promise<void> {
    const generation = ++loadGeneration;
    renderGeneration += 1;
    cancelPreviewWorker();
    loading.value = true;
    rendering.value = false;
    ready.value = false;
    error.value = "";
    frame.value = 0;
    frameCount.value = 1;
    duration.value = 0;
    seekGeneration += 1;
    clearTimeout(seekTimer);
    bitmap?.close();
    bitmap = undefined;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(props.file);
    await nextTick();
    try {
        if (isImageFile(props.file)) {
            const loadedBitmap = await createImageBitmap(props.file);
            if (generation !== loadGeneration) {
                loadedBitmap.close();
                return;
            }
            emit("source-dimensions", loadedBitmap.width, loadedBitmap.height);
            await nextTick();
            if (generation !== loadGeneration) {
                loadedBitmap.close();
                return;
            }
            bitmap = loadedBitmap;
            ready.value = true;
            await drawSource(bitmap);
            if (generation !== loadGeneration) return;
        } else {
            const element = video.value;
            if (!element) throw new Error("The video preview element is unavailable.");
            element.src = objectUrl;
            element.load();
            await waitForVideoEvent(element, "loadedmetadata");
            if (generation !== loadGeneration) return;
            duration.value = element.duration;
            frameCount.value = Math.max(1, Math.ceil(element.duration * FPS));
            emit("source-dimensions", element.videoWidth, element.videoHeight);
            await nextTick();
            if (generation !== loadGeneration) return;
            if (element.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
                await waitForVideoEvent(element, "loadeddata");
            }
            if (generation !== loadGeneration) return;
            ready.value = true;
            await drawSource(element);
            if (generation !== loadGeneration) return;
        }
    } catch (reason) {
        if (generation === loadGeneration) {
            ready.value = false;
            error.value = reason instanceof Error ? reason.message : String(reason);
        }
    } finally {
        if (generation === loadGeneration) loading.value = false;
    }
}

watch(() => props.file, loadFile, { immediate: true });
watch(frame, (value) => { if (videoFile.value && ready.value) scheduleFrame(value); });
watch(
    () => [
        props.mode,
        props.width,
        props.height,
        props.threshold,
        props.orderedDitherAmplitude,
        props.invert,
    ],
    () => {
        try {
            if (!ready.value) return;
            const render = bitmap
                ? drawSource(bitmap)
                : video.value?.readyState && videoFile.value
                    ? drawSource(video.value)
                    : undefined;
            render?.catch((reason) => {
                error.value = reason instanceof Error ? reason.message : String(reason);
            });
        } catch (reason) {
            error.value = reason instanceof Error ? reason.message : String(reason);
        }
    },
);

onMounted(() => {
    if (!canvas.value) return;
    canvasResizeObserver = new ResizeObserver(updateCanvasScaling);
    canvasResizeObserver.observe(canvas.value);
    updateCanvasScaling();
});

onBeforeUnmount(() => {
    loadGeneration += 1;
    seekGeneration += 1;
    renderGeneration += 1;
    clearTimeout(seekTimer);
    cancelPreviewWorker();
    canvasResizeObserver?.disconnect();
    bitmap?.close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
});
</script>

<template>
  <div class="media-preview">
    <div class="preview-stage">
      <canvas ref="canvas" class="preview-canvas" :class="{ 'is-downscaled': downscaled }" :aria-label="t.preview"/>
      <div v-if="loading || rendering" class="preview-loading"><a-spin/></div>
      <p v-if="error" class="preview-error">{{ error }}</p>
      <video ref="video" class="preview-video" muted playsinline preload="metadata"/>
    </div>
    <div v-if="videoFile" class="preview-timeline">
      <a-slider v-model="frame" :min="0" :max="Math.max(0, frameCount - 1)" :step="1" :show-tooltip="false"/>
      <span>{{ frameLabel }}</span>
    </div>
  </div>
</template>
