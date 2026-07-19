<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref} from "vue";
import {Message} from "@arco-design/web-vue";
import {IconDownload, IconLanguage, IconMoon, IconSun, IconUpload} from "@arco-design/web-vue/es/icon";
import {locale, setLocale, t, type Locale} from "./i18n";
import {generateDatapack} from "./generator";
import {preloadFFmpeg} from "./ffmpeg";
import type {ConversionMode} from "../src/cli";
import {isCushionColorMode, isRgbwMode} from "../src/cli";

const dark = ref(localStorage.getItem("theme") === "dark" || (!localStorage.getItem("theme") && matchMedia("(prefers-color-scheme: dark)").matches));
const file = ref<File>();
const mode = ref<ConversionMode>("color-ordered");
const width = ref(128);
const height = ref(96);
const start = ref(0);
const endText = ref("5");
const clipEnabled = ref(true);
const threshold = ref(128);
const invert = ref(false);
const macroStorage = ref(true);
const uuidEntities = ref(true);
const busy = ref(false);
const progress = ref(0);
const stage = ref("idle");
const error = ref("");
const outputUrl = ref("");
const ffmpegReady = ref(false);
const ffmpegError = ref("");
const ffmpegLoadProgress = ref(0);
let fakeProgressTimer: ReturnType<typeof setInterval> | undefined;
let preloadStartedAt = 0;

const modeOptions = computed(() => [
  {value: "binary", label: t.value.modeBinary},
  {value: "dither", label: t.value.modeGrayDither},
  {value: "ordered", label: t.value.modeGrayOrdered},
  {value: "rgbw-nearest", label: t.value.modeRgbwNearest},
  {value: "rgbw-dither", label: t.value.modeRgbwDither},
  {value: "color-nearest", label: t.value.modeNearest},
  {value: "color-dither", label: t.value.modeDither},
  {value: "color-ordered", label: t.value.modeOrdered},
]);
const stageLabel = computed(() => ({
  wasm: t.value.wasm,
  decode: t.value.decode,
  generate: t.value.generateStage,
  zip: t.value.zip,
  done: t.value.done,
  idle: t.value.idle
}[stage.value] || t.value.processing));
const fileSize = computed(() => file.value ? `${(file.value.size / 1024 / 1024).toFixed(1)} MB` : "");
const colorMode = computed(() => isCushionColorMode(mode.value));

function applyTheme(): void {
  document.body.setAttribute("arco-theme", dark.value ? "dark" : "light");
  localStorage.setItem("theme", dark.value ? "dark" : "light");
}

applyTheme();

function toggleTheme(): void {
  dark.value = !dark.value;
  applyTheme();
}

function chooseFile(event: Event): void {
  const selected = (event.target as HTMLInputElement).files?.[0];
  if (selected) {
    file.value = selected;
    error.value = "";
    if (outputUrl.value) URL.revokeObjectURL(outputUrl.value);
    outputUrl.value = "";
  }
}

async function generate(): Promise<void> {
  if (!file.value) return void Message.warning(t.value.noFile);
  if (width.value * height.value > 32768) return void Message.error(t.value.sizeLimit);
  if (isRgbwMode(mode.value) && (width.value % 2 !== 0 || height.value % 2 !== 0)) return void Message.error(t.value.sizeLimit);
  const clipStart = clipEnabled.value ? start.value : 0;
  const end = clipEnabled.value && endText.value.trim() !== "" ? Number(endText.value) : undefined;
  if (end !== undefined && end <= clipStart) return void Message.error(t.value.invalidClip);
  busy.value = true;
  error.value = "";
  progress.value = 0;
  stage.value = "wasm";
  if (outputUrl.value) URL.revokeObjectURL(outputUrl.value);
  outputUrl.value = "";
  try {
    const blob = await generateDatapack({
      file: file.value, mode: mode.value, width: width.value, height: height.value,
      threshold: threshold.value, invert: invert.value, start: clipStart, end,
      macroStorage: colorMode.value && macroStorage.value,
      uuidEntities: colorMode.value && uuidEntities.value,
      onStage: (nextStage, nextProgress) => {
        stage.value = nextStage;
        progress.value = Math.round(nextProgress * 100);
      },
    });
    outputUrl.value = URL.createObjectURL(blob);
    Message.success(t.value.completed);
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
    stage.value = "failed";
  } finally {
    busy.value = false;
  }
}

function changeLocale(value: unknown): void {
  setLocale(value as Locale);
}

async function loadFFmpeg(): Promise<void> {
  ffmpegError.value = "";
  ffmpegLoadProgress.value = 0;
  preloadStartedAt = performance.now();
  clearInterval(fakeProgressTimer);
  fakeProgressTimer = setInterval(() => {
    const elapsed = performance.now() - preloadStartedAt;
    const fallback = 0.95 * (1 - Math.exp(-elapsed / 20000));
    ffmpegLoadProgress.value = Math.max(ffmpegLoadProgress.value, fallback);
  }, 100);
  try {
    await preloadFFmpeg((ratio) => {
      ffmpegLoadProgress.value = Math.max(ffmpegLoadProgress.value, ratio);
    });
    ffmpegLoadProgress.value = 1;
    ffmpegReady.value = true;
  } catch (reason) {
    ffmpegError.value = reason instanceof Error ? reason.message : String(reason);
  } finally {
    clearInterval(fakeProgressTimer);
    fakeProgressTimer = undefined;
  }
}

onMounted(loadFFmpeg);
onBeforeUnmount(() => {
  clearInterval(fakeProgressTimer);
  if (outputUrl.value) URL.revokeObjectURL(outputUrl.value);
});
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand-block">
        <a-avatar shape="square">
          <img src="/icon.png" alt="Icon"/>
        </a-avatar>
        <div><h1>CusionBadApple</h1>
          <p>{{ t.subtitle }}</p></div>
      </div>
      <div class="top-actions">
        <a-select :model-value="locale" size="small" class="language-select" :aria-label="t.language"
                  @change="changeLocale">
          <template #prefix>
            <IconLanguage/>
          </template>
          <a-option value="zh-CN">中文</a-option>
          <a-option value="en-US">English</a-option>
        </a-select>
        <a-tooltip :content="dark ? t.light : t.dark">
          <a-button class="icon-button" shape="circle" @click="toggleTheme">
            <IconSun v-if="dark"/>
            <IconMoon v-else/>
          </a-button>
        </a-tooltip>
      </div>
    </header>

    <main class="workspace">
      <aside class="settings-panel">
        <h2>{{ t.settings }}</h2>
        <div class="field"><label>{{ t.mode }}</label>
          <a-select v-model="mode">
            <a-option v-for="item in modeOptions" :key="item.value" :value="item.value">{{ item.label }}</a-option>
          </a-select>
        </div>
        <div class="field"><label>{{ t.resolution }}</label>
          <div class="two-col">
            <a-input-number v-model="width" :min="16" :max="256">
              <template #prefix>{{ t.width }}</template>
            </a-input-number>
            <a-input-number v-model="height" :min="16" :max="256">
              <template #prefix>{{ t.height }}</template>
            </a-input-number>
          </div>
        </div>
        <div class="switch-row switch-row-first">
          <div><strong>{{ t.clip }}</strong><span>{{ clipEnabled ? t.clipHint : t.fullVideoHint }}</span></div>
          <a-switch v-model="clipEnabled"/>
        </div>
        <div v-if="clipEnabled" class="field clip-fields">
          <div class="two-col">
            <a-input-number v-model="start" :min="0">
              <template #prefix>{{ t.start }}</template>
            </a-input-number>
            <a-input v-model="endText" :placeholder="t.clearEnd">
              <template #prefix>{{ t.end }}</template>
            </a-input>
          </div>
        </div>
        <div v-if="mode === 'binary' || mode === 'dither' || mode === 'ordered'" class="field"><label>{{
            t.threshold
          }}</label>
          <a-slider v-model="threshold" :min="0" :max="255" show-input/>
        </div>
        <div class="switch-row" :class="{ muted: !colorMode }">
          <div><strong>{{ t.macroStorage }}</strong><span>{{ t.macroStorageHint }}</span></div>
          <a-switch v-model="macroStorage" :disabled="!colorMode"/>
        </div>
        <div class="switch-row" :class="{ muted: !colorMode }">
          <div><strong>{{ t.uuidEntities }}</strong><span>{{ t.uuidEntitiesHint }}</span></div>
          <a-switch v-model="uuidEntities" :disabled="!colorMode"/>
        </div>
        <div class="switch-row"><strong>{{ t.invert }}</strong>
          <a-switch v-model="invert"/>
        </div>
      </aside>

      <section class="content-panel">
        <div class="section-heading">
          <div><h2>{{ t.video }}</h2>
            <p>{{ t.local }}</p></div>
          <span class="status-dot" :class="{ active: file }">{{ file ? t.selected : t.idle }}</span></div>
        <label class="drop-zone">
          <input class="file-input" type="file" accept="video/*,.mkv,.avi" @change="chooseFile"/>
          <IconUpload :size="30"/>
          <strong>{{ t.drop }}</strong>
          <span v-if="file">{{ file.name }} · {{ fileSize }}</span>
          <span v-else>MP4 · WebM · MOV · MKV</span>
        </label>

        <div class="memory-note"><strong>{{ t.memory }}</strong><span>{{ t.memoryText }}</span></div>

        <div class="output-band">
          <div class="progress-copy"><strong>{{ stageLabel }}</strong><span>{{ progress }}%</span></div>
          <a-progress :percent="progress / 100" :show-text="false" :status="error ? 'danger' : 'normal'"/>
          <p v-if="error" class="error-text">{{ error }}</p>
          <div class="commands">
            <a-button type="primary" size="large" :loading="busy" :disabled="!file" @click="generate">
              <IconUpload/>
              {{ t.generate }}
            </a-button>
            <a-button size="large" :disabled="!outputUrl" :href="outputUrl" download="CusionBadApple-datapack.zip">
              <IconDownload/>
              {{ t.download }}
            </a-button>
          </div>
        </div>
      </section>
    </main>
    <div v-if="!ffmpegReady" class="preload-overlay" role="status" aria-live="polite">
      <div class="preload-panel">
        <div class="preload-heading"><strong>{{ t.preloadTitle }}</strong><span>{{
            Math.round(ffmpegLoadProgress * 100)
          }}%</span></div>
        <a-progress :percent="ffmpegLoadProgress" :show-text="false" :status="ffmpegError ? 'danger' : 'normal'"/>
        <p>{{ ffmpegError ? t.preloadFailed : t.preloadHint }}</p>
        <p v-if="ffmpegError" class="error-text">{{ ffmpegError }}</p>
        <a-button v-if="ffmpegError" type="primary" @click="loadFFmpeg">{{ t.retry }}</a-button>
      </div>
    </div>
  </div>
</template>
