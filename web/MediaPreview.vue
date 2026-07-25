<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import type { ConversionMode } from "../src/cli";
import { isCushionColorMode, isRgbwMode } from "../src/cli";
import { CALIBRATED_STATES } from "../src/calibration";
import { convertCushionColorFrame, convertFrame, convertRgbwFrame } from "../src/converter";
import { isImageFile } from "./generator";
import { t } from "./i18n";

const FPS = 20;
const PIXEL_SIZE = 16;
const MAX_PREVIEW_DIMENSION = 256;

const props = defineProps<{
    file: File;
    mode: ConversionMode;
    width: number;
    height: number;
    threshold: number;
    invert: boolean;
}>();

const canvas = ref<HTMLCanvasElement>();
const video = ref<HTMLVideoElement>();
const frame = ref(0);
const frameCount = ref(1);
const duration = ref(0);
const loading = ref(true);
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

function previewDimensions(): { width: number; height: number } {
    const scale = Math.min(
        1,
        MAX_PREVIEW_DIMENSION / props.width,
        MAX_PREVIEW_DIMENSION / props.height,
    );
    let width = Math.max(1, Math.floor(props.width * scale));
    let height = Math.max(1, Math.floor(props.height * scale));
    if (isRgbwMode(props.mode)) {
        width = Math.max(2, width - width % 2);
        height = Math.max(2, height - height % 2);
    }
    return { width, height };
}

type PreviewSource = ImageBitmap | HTMLVideoElement;

function sourceSize(source: PreviewSource): { width: number; height: number } {
    if (source instanceof HTMLVideoElement) {
        return { width: source.videoWidth, height: source.videoHeight };
    }
    return { width: source.width, height: source.height };
}

function sampleRgb(
    source: PreviewSource,
    width: number,
    height: number,
): Uint8Array {
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
    const rgba = context.getImageData(0, 0, width, height).data;
    const rgb = new Uint8Array(width * height * 3);
    for (let index = 0; index < width * height; index += 1) {
        rgb[index * 3] = rgba[index * 4];
        rgb[index * 3 + 1] = rgba[index * 4 + 1];
        rgb[index * 3 + 2] = rgba[index * 4 + 2];
    }
    return rgb;
}

function rgbwColor(index: number, width: number): string {
    const x = index % width;
    const y = Math.floor(index / width);
    if (y % 2 === 0) return x % 2 === 0 ? "#ff3b30" : "#34c759";
    return x % 2 === 0 ? "#3d7eff" : "#fff";
}

function drawSource(source: PreviewSource): void {
    const target = canvas.value;
    if (!target) return;
    const preview = previewDimensions();
    const rgbw = isRgbwMode(props.mode);
    const cushionColor = isCushionColorMode(props.mode);
    const logicalWidth = rgbw ? preview.width / 2 : preview.width;
    const logicalHeight = rgbw ? preview.height / 2 : preview.height;
    const rgb = sampleRgb(source, logicalWidth, logicalHeight);
    const converted = cushionColor
        ? convertCushionColorFrame(rgb, logicalWidth, logicalHeight, props.mode, props.invert)
        : rgbw
            ? convertRgbwFrame(rgb, logicalWidth, logicalHeight, props.mode, props.invert)
            : convertFrame(
                Uint8Array.from({ length: logicalWidth * logicalHeight }, (_, index) =>
                    Math.round(
                        rgb[index * 3] * 0.299 +
                        rgb[index * 3 + 1] * 0.587 +
                        rgb[index * 3 + 2] * 0.114,
                    )),
                preview.width,
                preview.height,
                props.mode,
                props.threshold,
                props.invert,
            );

    target.width = preview.width * PIXEL_SIZE;
    target.height = preview.height * PIXEL_SIZE;
    const context = target.getContext("2d");
    if (!context) throw new Error("The browser does not provide a preview canvas context.");
    context.imageSmoothingEnabled = false;
    for (let index = 0; index < converted.length; index += 1) {
        if (cushionColor) {
            const color = CALIBRATED_STATES[converted[index]];
            context.fillStyle = `rgb(${color.red} ${color.green} ${color.blue})`;
        } else if (rgbw) {
            context.fillStyle = converted[index] ? rgbwColor(index, preview.width) : "#08090a";
        } else {
            context.fillStyle = converted[index] ? "#fff" : "#08090a";
        }
        context.fillRect(
            index % preview.width * PIXEL_SIZE,
            Math.floor(index / preview.width) * PIXEL_SIZE,
            PIXEL_SIZE,
            PIXEL_SIZE,
        );
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
    drawSource(element);
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
    loading.value = true;
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
            bitmap = await createImageBitmap(props.file);
            if (generation !== loadGeneration) return;
            drawSource(bitmap);
        } else {
            const element = video.value;
            if (!element) throw new Error("The video preview element is unavailable.");
            element.src = objectUrl;
            element.load();
            await waitForVideoEvent(element, "loadedmetadata");
            if (generation !== loadGeneration) return;
            duration.value = element.duration;
            frameCount.value = Math.max(1, Math.ceil(element.duration * FPS));
            await waitForVideoEvent(element, "loadeddata");
            if (generation !== loadGeneration) return;
            drawSource(element);
        }
        ready.value = true;
    } catch (reason) {
        if (generation === loadGeneration) {
            error.value = reason instanceof Error ? reason.message : String(reason);
        }
    } finally {
        if (generation === loadGeneration) loading.value = false;
    }
}

watch(() => props.file, loadFile, { immediate: true });
watch(frame, (value) => { if (videoFile.value && ready.value) scheduleFrame(value); });
watch(
    () => [props.mode, props.width, props.height, props.threshold, props.invert],
    () => {
        try {
            if (!ready.value) return;
            if (bitmap) drawSource(bitmap);
            else if (video.value?.readyState && videoFile.value) drawSource(video.value);
        } catch (reason) {
            error.value = reason instanceof Error ? reason.message : String(reason);
        }
    },
);

onBeforeUnmount(() => {
    loadGeneration += 1;
    seekGeneration += 1;
    clearTimeout(seekTimer);
    bitmap?.close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
});
</script>

<template>
  <div class="media-preview">
    <div class="preview-stage">
      <canvas ref="canvas" class="preview-canvas" :aria-label="t.preview"/>
      <div v-if="loading" class="preview-loading"><a-spin/></div>
      <p v-if="error" class="preview-error">{{ error }}</p>
      <video ref="video" class="preview-video" muted playsinline preload="metadata"/>
    </div>
    <div v-if="videoFile" class="preview-timeline">
      <a-slider v-model="frame" :min="0" :max="Math.max(0, frameCount - 1)" :step="1" :show-tooltip="false"/>
      <span>{{ frameLabel }}</span>
    </div>
  </div>
</template>
