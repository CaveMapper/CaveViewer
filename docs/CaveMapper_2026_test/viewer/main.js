/**
 * CaveMapper Viewer — .cavev（glTF 2.0バイナリ）Webビューアー
 *
 * フォーマット仕様は CaveMapperStudio リポジトリの docs/cavev_spec.md を参照。
 * ノード判定は名前ではなく extras の識別タグ（cm_kind / cm_type / cm_part）で行う。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

const SUPPORTED_FORMAT_VERSION = 1;

// 注記種別（cm_type）の全種
const ANNOTATION_TYPES = [
  'rope', 'note', 'survey', 'distance',
  'scale', 'direction', 'stand', 'crawl',
];

// 表示切替トグルの定義
// 注記: ロープ・ノート・方角・スケールバー・人間（立ち/匍匐） / 寸法: 測線・距離計測
const TOGGLE_DEFS = [
  { key: 'anno', types: ['rope', 'note', 'scale', 'direction', 'stand', 'crawl'] },
  { key: 'dims', types: ['survey', 'distance'] },
];

// ── i18n ─────────────────────────────────────────────────────────────────────

const STRINGS = {
  ja: {
    view_mode: '洞窟メッシュ表示',
    solid: '外側',
    culling: '内側',
    annotations: '注記表示',
    camera: 'カメラ位置',
    background: '背景',
    dark: 'ダーク',
    light: 'ライト',
    reset_view: 'リセット',
    language: '言語',
    lang_ja: '日本語',
    lang_en: '英語',
    mouse_mode: 'マウス操作',
    mouse_standard: '標準',
    mouse_studio: 'Studio',
    loading: '読み込み中…',
    load_error: 'ファイルを読み込めませんでした',
    not_cavev: 'cavev形式ではないファイルです（表示を試みます）',
    newer_version: '新しいバージョンのcavevファイルです。表示が不完全な可能性があります',
    no_cave: '洞窟メッシュが含まれていません',
    open_prompt: '.cavevファイルをここにドラッグ＆ドロップ するか',
    open_file: 'ファイルを選択',
    hint: '左ドラッグ: 回転　　右ドラッグ: 移動　　ホイール: ズーム',
    hint_studio: '中ドラッグ: 回転　　Shift+中ドラッグ: 移動　　Ctrl+中ドラッグ: ドリー　　ホイール: ズーム',
    type_anno: '注記',
    type_dims: '寸法',
  },
  en: {
    view_mode: 'Cave mesh display',
    solid: 'Outside',
    culling: 'Inside',
    annotations: 'Annotations',
    camera: 'Camera',
    background: 'Background',
    dark: 'Dark',
    light: 'Light',
    reset_view: 'Reset',
    language: 'Language',
    lang_ja: 'Japanese',
    lang_en: 'English',
    mouse_mode: 'Mouse controls',
    mouse_standard: 'Standard',
    mouse_studio: 'Studio',
    loading: 'Loading…',
    load_error: 'Failed to load the file',
    not_cavev: 'Not a cavev file (attempting to display anyway)',
    newer_version: 'This cavev file uses a newer format version; display may be incomplete',
    no_cave: 'No cave mesh found in this file',
    open_prompt: 'Drag & drop a .cavev file here, or',
    open_file: 'Choose file',
    hint: 'Left drag: rotate    Right drag: pan    Wheel: zoom',
    hint_studio: 'Middle drag: rotate    Shift+Middle: pan    Ctrl+Middle: dolly    Wheel: zoom',
    type_anno: 'Annotations',
    type_dims: 'Dimensions',
  },
};

let lang = localStorage.getItem('cavev_lang')
  || (navigator.language && navigator.language.startsWith('ja') ? 'ja' : 'en');

function t(key) {
  return (STRINGS[lang] && STRINGS[lang][key]) || STRINGS.ja[key] || key;
}

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.documentElement.lang = lang;
  // 注記チェックボックスのラベルを更新
  // （data-key を持つテキストスパンのみ。見た目描画用の .cbox スパンは対象外）
  document.querySelectorAll('#anno-toggles label span[data-key]').forEach((el) => {
    el.textContent = t(`type_${el.dataset.key}`);
  });
  document.getElementById('btn-lang-ja').classList.toggle('active', lang === 'ja');
  document.getElementById('btn-lang-en').classList.toggle('active', lang === 'en');
  // 操作ヒント（マウス操作モードで文言が変わる）
  document.getElementById('hint').textContent =
    t(mouseMode === 'studio' ? 'hint_studio' : 'hint');
}

// ── 背景テーマ ────────────────────────────────────────────────────────────────

const BG = {
  dark:  { clear: 0x2b2f36, line: 0xffffff },
  light: { clear: 0xdfe3e8, line: 0x303030 },
};
let bgMode = 'dark';

// ── Three.js 基盤 ─────────────────────────────────────────────────────────────

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
// 頂点カラーのベイク結果を忠実に表示するためトーンマッピングは行わない
renderer.toneMapping = THREE.NoToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color(BG.dark.clear);

const camera = new THREE.PerspectiveCamera(55, 1, 0.01, 1000);
camera.position.set(0, 5, 10);
scene.add(camera);

// 環境光＋ヘッドライト（カメラ追従。ベイク済み頂点カラーを活かす控えめな構成）
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 2.4));
const headlight = new THREE.DirectionalLight(0xffffff, 1.2);
camera.add(headlight);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.1;
controls.zoomSpeed = 2.0;   // ホイールズーム感度（既定1.0の2倍）

// ── オンデマンド描画: 変化があったフレームだけレンダリングする
// （常時描画はウィンドウ移動時等にDWM合成と競合してチラつく・無駄な消費電力）
let needsRender = true;
function invalidate() { needsRender = true; }
controls.addEventListener('change', invalidate);

// ── マウス操作モード（standard: 一般的な左ドラッグ回転 / studio: Studio同等の中ボタン主体）
let mouseMode = localStorage.getItem('cavev_mouse') === 'studio' ? 'studio' : 'standard';

// タッチ専用端末（マウス等の高精度ポインタが無い＝モバイル/タブレット）の判定。
// タッチ操作はモード設定に依らずOrbitControls既定で有効なため、マウス操作の
// メニューと操作ヒントは表示しない。
const touchOnly = !window.matchMedia('(any-pointer: fine)').matches;

function applyMouseMode() {
  if (mouseMode === 'studio') {
    // CaveMapperStudioと同じ: 中ドラッグ=回転 / Shift+中=移動 / Ctrl+中=ドリー
    // （修飾キーの判定はpointerdownフックで行う）
    controls.mouseButtons = {
      LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: null,
    };
  } else {
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN,
    };
  }
  $('btn-mouse-standard').classList.toggle('active', mouseMode === 'standard');
  $('btn-mouse-studio').classList.toggle('active', mouseMode === 'studio');
  $('hint').textContent = t(mouseMode === 'studio' ? 'hint_studio' : 'hint');
}

// studioモードの修飾キー: OrbitControlsが読み取る前(captureフェーズ)に割当を差し替える。
// 注意: OrbitControlsはROTATE割当のボタンをShift付きで押すと内部でパンに切り替える
// （PAN割当だと逆に回転へ反転してしまう）ため、Shift+中はROTATEのままにしておく。
canvas.addEventListener('pointerdown', (e) => {
  if (mouseMode !== 'studio' || e.button !== 1) return;
  controls.mouseButtons.MIDDLE = e.ctrlKey ? THREE.MOUSE.DOLLY : THREE.MOUSE.ROTATE;
}, true);

// ── カメラ操作終了時にスクリーン中央レイキャストで回転中心を自動更新
// （CaveMapperStudioの「Rotate Around Selection」相当の追従。中央を通るレイ上の
// 点にtargetを移すだけなので視界はジャンプしない）
const _pivotRaycaster = new THREE.Raycaster();
const _screenCenter = new THREE.Vector2(0, 0);

function isChainVisible(obj) {
  for (let p = obj; p; p = p.parent) {
    if (p.visible === false) return false;
  }
  return true;
}

function updateOrbitPivot() {
  if (!modelRoot) return;
  _pivotRaycaster.setFromCamera(_screenCenter, camera);
  let hits;
  try {
    hits = _pivotRaycaster.intersectObject(modelRoot, true);
  } catch {
    return;   // fat line等のレイキャスト例外は無視
  }
  for (const h of hits) {
    // 対象は可視メッシュのみ（ラベルスプライト・ラインは回転中心にしない）
    if (!h.object.isMesh || !isChainVisible(h.object)) continue;
    controls.target.copy(h.point);
    controls.update();
    break;
  }
}
controls.addEventListener('end', updateOrbitPivot);

// ── シーン状態 ────────────────────────────────────────────────────────────────

let modelRoot = null;              // 読み込んだ glTF シーン
let caveMaterials = [];            // 洞窟メッシュのマテリアル（カリング切替対象）
let typeGroups = {};               // cm_type → 種別グループ Object3D
let lineMaterials = [];            // fat line マテリアル（解像度・色更新対象）
let monoMaterials = [];            // 黒系注記マテリアル（背景に応じ白/黒切替対象）
let labelSwaps = [];               // ラベルテクスチャの白/黒差し替え {material, white, black}
let surveySprites = [];            // 測線の数値ラベル（カリング表示中のみ表示）
let fitSphere = null;              // 視点リセット用バウンディング球
let cullingMode = false;

// 背景に応じて白/黒を切り替える黒系注記（cm_type / cm_part での判定条件）
function isMonoAnnotation(ud) {
  return ud.cm_kind === 'annotation' && (
    ud.cm_type === 'scale'
    || ud.cm_type === 'direction'
    || ud.cm_part === 'leader'     // ノート引出線
    || ud.cm_part === 'arrow'      // 距離計測の矢尻
  );
}

// ── UI要素 ────────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);
const show = (id) => $(id).classList.remove('hidden');
const hide = (id) => $(id).classList.add('hidden');

function showWarn(message) {
  const el = $('warn');
  el.textContent = message;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 8000);
}

function showError(detail) {
  hide('loading');
  hide('landing');
  $('error-detail').textContent = detail || '';
  show('error');
}

// ── ロード処理 ────────────────────────────────────────────────────────────────

async function fetchWithProgress(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const total = Number(res.headers.get('Content-Length')) || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    const mb = (received / 1048576).toFixed(1);
    $('load-progress').textContent = total
      ? ` ${Math.round((received / total) * 100)}%`
      : ` ${mb} MB`;
  }
  const buf = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) { buf.set(c, offset); offset += c.length; }
  return buf.buffer;
}

function loadFromUrl(url) {
  show('loading');
  $('load-progress').textContent = '';
  fetchWithProgress(url)
    .then((buffer) => parseGlb(buffer, decodeURIComponent(url.split('/').pop() || url)))
    .catch((err) => showError(String(err)));
}

function loadFromFile(file) {
  show('loading');
  hide('landing');
  $('load-progress').textContent = '';
  file.arrayBuffer()
    .then((buffer) => parseGlb(buffer, file.name))
    .catch((err) => showError(String(err)));
}

function parseGlb(buffer, displayName) {
  new GLTFLoader().parse(
    buffer,
    '',
    (gltf) => {
      try {
        onModelLoaded(gltf, displayName);
        hide('loading');
      } catch (err) {
        showError(String(err));
      }
    },
    (err) => showError(err && err.message ? err.message : String(err)),
  );
}

// ── モデル構築 ────────────────────────────────────────────────────────────────

function onModelLoaded(gltf, displayName) {
  // 既存モデルを破棄（ドラッグ&ドロップでの読み替えに対応）
  if (modelRoot) {
    scene.remove(modelRoot);
    modelRoot.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      }
    });
  }
  caveMaterials = [];
  typeGroups = {};
  lineMaterials = [];
  monoMaterials = [];
  labelSwaps = [];
  surveySprites = [];

  // cavemapperメタデータ検査（glTFトップレベルextras）
  const meta = gltf.parser.json.extras && gltf.parser.json.extras.cavemapper;
  if (!meta || meta.format !== 'cavev') {
    showWarn(t('not_cavev'));
  } else if (meta.format_version > SUPPORTED_FORMAT_VERSION) {
    showWarn(t('newer_version'));
  }

  modelRoot = gltf.scene;
  scene.add(modelRoot);

  // ── ノード走査: 種別グループ・洞窟メッシュ・注記・ラインを収集 ──────────
  const caveMeshes = [];
  const lineObjects = [];
  const monoSet = new Set();
  const labelMatSet = new Set();
  const labelBasicCache = new Map();   // 元マテリアル → アンリット変換後（共有維持）
  const monoBasicCache = new Map();
  modelRoot.traverse((o) => {
    const ud = o.userData || {};
    if (ud.cm_kind === 'group' && ANNOTATION_TYPES.includes(ud.cm_type)) {
      typeGroups[ud.cm_type] = o;
    }
    if (ud.cm_kind === 'cave' && o.isMesh) {
      caveMeshes.push(o);
    }
    if (o.isLineSegments || (o.isLine && !o.isLineSegments)) {
      lineObjects.push(o);
    }
    if (ud.cm_kind === 'annotation' && o.isMesh) {
      // 距離計測の焼き込み数値ラベルは非表示（ビューアーのスプライト表示で代替）
      if (ud.cm_type === 'distance' && ud.cm_part === 'label') {
        o.visible = false;
        return;
      }
      // ラベルテクスチャ・黒系注記は照明の影響を受けないアンリット材質に変換する
      // （ライティング材質のままだと法線の向き次第で白が灰色に沈む）
      const convert = (m) => {
        if (m.map) {
          let basic = labelBasicCache.get(m);
          if (!basic) {
            basic = new THREE.MeshBasicMaterial({
              map: m.map,
              transparent: true,
              side: THREE.DoubleSide,
              depthWrite: m.depthWrite,
            });
            labelBasicCache.set(m, basic);
            labelMatSet.add(basic);    // テクスチャ文字（ノート/スケール等）
          }
          return basic;
        }
        if (isMonoAnnotation(ud)) {
          let basic = monoBasicCache.get(m);
          if (!basic) {
            basic = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
            monoBasicCache.set(m, basic);
            monoSet.add(basic);        // 黒系ソリッド注記（色はsetBackgroundが設定）
          }
          return basic;
        }
        return m;
      };
      o.material = Array.isArray(o.material)
        ? o.material.map(convert)
        : convert(o.material);
    }
  });

  // ── 黒系注記・ラベルテクスチャの背景連動色 ──────────────────────────────
  monoMaterials = [...monoSet];
  labelSwaps = [...labelMatSet].map((m) => ({
    material: m,
    white: recolorTexture(m.map, '#ffffff'),
    black: recolorTexture(m.map, '#1a1a1a'),
  }));

  // ── 洞窟メッシュ: マテリアルをクローンして収集（カリング切替対象）──────
  // GLTFLoaderはマテリアルを共有し得るため、注記側に影響しないよう洞窟専用に
  // クローンする（同一元マテリアルのクローンはキャッシュで共有を維持）
  _caveCloneCache.clear();
  const matSet = new Set();
  caveMeshes.forEach((mesh) => {
    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map((m) => cloneCaveMaterial(m, matSet));
    } else {
      mesh.material = cloneCaveMaterial(mesh.material, matSet);
    }
  });
  caveMaterials = [...matSet];
  applyCulling();

  // ── LINESプリミティブ → fat line 置換（1px線の視認性対策）──────────────
  // 測線・距離計測（寸法線）には計測値ラベルのスプライトを付与する
  lineObjects.forEach((line) => {
    const ud = line.userData || {};
    const info = measureLineGeometry(line.geometry);
    const fat = replaceWithFatLine(line);
    if (!fat || !info) return;
    const isSurvey   = ud.cm_type === 'survey' && ud.cm_part === 'body';
    const isDimLine  = ud.cm_type === 'distance' && ud.cm_part === 'dim';
    if (isSurvey || isDimLine) {
      const sprite = makeValueSprite(`${info.length.toFixed(2)} m`);
      sprite.position.copy(info.center);
      fat.add(sprite);
      if (isSurvey) surveySprites.push(sprite);
    }
    // 測線: セグメント毎の長さも総延長の半分サイズで表示（1セグメントの場合は
    // 総延長と同値になるため出さない）
    if (isSurvey && info.segments.length >= 2) {
      info.segments.forEach((seg) => {
        const s = makeValueSprite(`${seg.length.toFixed(2)} m`, 0.5);
        s.position.copy(seg.mid);
        fat.add(s);
        surveySprites.push(s);
      });
    }
  });
  // 測線ラベルの初期表示状態（ソリッド表示中は非表示）を反映
  applyCulling();

  // ── 注記チェックボックス構築 ────────────────────────────────────────────
  buildAnnotationToggles();

  // ── カメラフィット ──────────────────────────────────────────────────────
  const caveGroup = findGroup('cave');
  const target = (caveGroup && caveMeshes.length > 0) ? caveGroup : modelRoot;
  const box = new THREE.Box3().setFromObject(target);
  if (box.isEmpty()) {
    showWarn(t('no_cave'));
    fitSphere = new THREE.Sphere(new THREE.Vector3(), 5);
  } else {
    fitSphere = box.getBoundingSphere(new THREE.Sphere());
    if (caveMeshes.length === 0) showWarn(t('no_cave'));
  }
  resetView();

  // 現在の背景モードを黒系注記・ラベルテクスチャに反映
  setBackground(bgMode);

  // E2Eテスト・デバッグ用の内部状態フック（機能への影響なし）
  window.__cavevDebug = {
    labelSwaps, monoMaterials, lineMaterials, typeGroups,
    setBackground, camera, controls, THREE,
  };

  const titleEl = $('panel-title');
  titleEl.textContent = displayName;
  titleEl.title = displayName;   // 省略表示時のツールチップ
  show('panel');
  if (!touchOnly) show('hint');
  invalidate();
}

/**
 * ラインジオメトリの総延長と中心（バウンディングボックス中心）を求める。
 * LINESプリミティブ（index有無両対応）のセグメント長の総和 = 測線の総延長／寸法値。
 */
function measureLineGeometry(geom) {
  const pos = geom.getAttribute('position');
  if (!pos) return null;
  const idx = (i) => (geom.index ? geom.index.getX(i) : i);
  const count = geom.index ? geom.index.count : pos.count;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  let length = 0;
  const segments = [];
  for (let i = 0; i + 1 < count; i += 2) {
    a.fromBufferAttribute(pos, idx(i));
    b.fromBufferAttribute(pos, idx(i + 1));
    const segLen = a.distanceTo(b);
    if (segLen <= 0) continue;
    length += segLen;
    segments.push({
      length: segLen,
      mid: new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5),
    });
  }
  if (length <= 0) return null;
  geom.computeBoundingBox();
  const center = geom.boundingBox.getCenter(new THREE.Vector3());
  return { length, center, segments };
}

/**
 * 計測値ラベルのスプライトを生成する（スクリーン固定サイズ・常にカメラ正対・
 * 黒地半透明＋白文字。Studio内画面表示と同じルックで、背景モードに依存しない）。
 */
function makeValueSprite(text, sizeScale = 1) {
  const fontPx = 44;
  const padX = 16;
  const padY = 10;
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  ctx.font = `${fontPx}px "Segoe UI", sans-serif`;
  const textW = Math.ceil(ctx.measureText(text).width);
  cv.width  = textW + padX * 2;
  cv.height = fontPx + padY * 2;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.beginPath();
  ctx.roundRect(0, 0, cv.width, cv.height, 10);
  ctx.fill();
  ctx.font = `${fontPx}px "Segoe UI", sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, padX, cv.height / 2 + 2);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    sizeAttenuation: false,   // カメラ距離に依らずスクリーン上で一定サイズ
    depthTest: false,         // 壁越しでも読めるように前面表示
    transparent: true,
  });
  const sprite = new THREE.Sprite(mat);
  const h = 0.045 * sizeScale;   // 画面高さに対する比率ベースのサイズ
  sprite.scale.set(h * (cv.width / cv.height), h, 1);
  sprite.renderOrder = 999;
  return sprite;
}

/** ラベルテクスチャの文字色を差し替えたテクスチャを生成する（アルファ形状は維持） */
function recolorTexture(srcTex, cssColor) {
  const img = srcTex.image;
  const cv = document.createElement('canvas');
  cv.width = img.width;
  cv.height = img.height;
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0);
  ctx.globalCompositeOperation = 'source-in';   // 不透明部分だけを単色で塗る
  ctx.fillStyle = cssColor;
  ctx.fillRect(0, 0, cv.width, cv.height);

  const tex = new THREE.CanvasTexture(cv);
  tex.flipY = srcTex.flipY;                     // glTF由来はflipY=false
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = srcTex.wrapS;
  tex.wrapT = srcTex.wrapT;
  return tex;
}

/** 洞窟メッシュのマテリアルをクローンして matSet に登録する（元マテリアル単位で共有維持） */
const _caveCloneCache = new Map();
function cloneCaveMaterial(mat, matSet) {
  let clone = _caveCloneCache.get(mat);
  if (!clone) {
    clone = mat.clone();
    // glTFのmetallic既定値は1.0で、環境マップなしでは真っ暗になる。
    // 洞窟メッシュはベイク済み頂点カラーの発色を優先し非金属マットに固定する
    if ('metalness' in clone) clone.metalness = 0.0;
    if ('roughness' in clone) clone.roughness = 1.0;
    _caveCloneCache.set(mat, clone);
  }
  matSet.add(clone);
  return clone;
}

function findGroup(cmType) {
  let found = null;
  if (!modelRoot) return null;
  modelRoot.traverse((o) => {
    if (!found && o.userData && o.userData.cm_kind === 'group'
        && o.userData.cm_type === cmType) {
      found = o;
    }
  });
  return found;
}

/** LineSegments/Line を LineSegments2（ピクセル幅指定の fat line）に置き換える */
function replaceWithFatLine(line) {
  const geom = line.geometry;
  const posAttr = geom.getAttribute('position');
  if (!posAttr) return null;

  // セグメントごとの頂点ペア配列に展開（indexあり/なし両対応）
  const positions = [];
  const pushVert = (i) => {
    positions.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
  };
  if (geom.index) {
    for (let i = 0; i < geom.index.count; i++) pushVert(geom.index.getX(i));
  } else {
    for (let i = 0; i < posAttr.count; i++) pushVert(i);
  }
  if (positions.length < 6) return null;

  const fatGeom = new LineSegmentsGeometry();
  fatGeom.setPositions(positions);

  const mat = new LineMaterial({
    color: BG[bgMode].line,
    linewidth: 2,           // ピクセル単位
    worldUnits: false,
  });
  mat.resolution.set(canvas.clientWidth, canvas.clientHeight);
  lineMaterials.push(mat);

  const fat = new LineSegments2(fatGeom, mat);
  fat.name = line.name;
  fat.userData = line.userData;
  fat.position.copy(line.position);
  fat.quaternion.copy(line.quaternion);
  fat.scale.copy(line.scale);
  fat.computeLineDistances();

  line.parent.add(fat);
  line.parent.remove(line);
  geom.dispose();
  if (line.material && line.material.dispose) line.material.dispose();
  return fat;
}

// ── 注記チェックボックス ──────────────────────────────────────────────────────

function buildAnnotationToggles() {
  const holder = $('anno-toggles');
  holder.innerHTML = '';
  TOGGLE_DEFS.forEach(({ key, types }) => {
    const groups = types.map((tp) => typeGroups[tp]).filter(Boolean);
    if (groups.length === 0) return;   // ファイルに存在しない種別は表示しない
    const label = document.createElement('label');
    label.classList.add('on');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.addEventListener('change', () => {
      groups.forEach((g) => { g.visible = cb.checked; });
      // 見た目はlabelのクラスで描画する（input:checked疑似クラスは
      // QtWebEngineで再スタイルされない不具合があるため）
      label.classList.toggle('on', cb.checked);
      invalidate();
    });
    const box = document.createElement('span');
    box.className = 'cbox';
    const span = document.createElement('span');
    span.dataset.key = key;
    span.textContent = t(`type_${key}`);
    label.append(cb, box, span);
    holder.appendChild(label);
  });
}

// ── 表示モード（ソリッド/カリング）──────────────────────────────────────────

function applyCulling() {
  // 洞窟メッシュの法線は内向き（cavev仕様）。FrontSide描画にすると
  // カメラ側の壁がカリングされ、外から洞窟内部が透けて見える。
  const side = cullingMode ? THREE.FrontSide : THREE.DoubleSide;
  caveMaterials.forEach((m) => { m.side = side; });
  // 測線の数値ラベルはカリング表示中のみ表示する
  // （ソリッド表示では測線自体が外壁に隠れて見えないため）
  surveySprites.forEach((s) => { s.visible = cullingMode; });
  invalidate();
}

function setCulling(on) {
  cullingMode = on;
  applyCulling();
  $('btn-solid').classList.toggle('active', !on);
  $('btn-culling').classList.toggle('active', on);
}

// ── 背景切替 ─────────────────────────────────────────────────────────────────

function setBackground(mode) {
  bgMode = mode;
  scene.background.set(BG[mode].clear);
  document.body.classList.toggle('bg-light', mode === 'light');
  lineMaterials.forEach((m) => m.color.set(BG[mode].line));
  // 黒系注記（スケールバー・方角・引出線・矢尻）: ダーク時は白、ライト時は黒
  const monoColor = mode === 'dark' ? 0xffffff : 0x1a1a1a;
  monoMaterials.forEach((m) => m.color.set(monoColor));
  // ラベルテクスチャ（ノート/スケールの文字）: 文字色を背景に合わせて差し替え
  labelSwaps.forEach(({ material, white, black }) => {
    material.map = mode === 'dark' ? white : black;
    material.needsUpdate = true;
  });
  $('btn-bg-dark').classList.toggle('active', mode === 'dark');
  $('btn-bg-light').classList.toggle('active', mode === 'light');
  invalidate();
}

// ── カメラ ───────────────────────────────────────────────────────────────────

function resetView() {
  if (!fitSphere) return;
  const r = Math.max(fitSphere.radius, 0.1);
  const c = fitSphere.center;
  const dist = r / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.15;
  camera.near = Math.max(dist / 1000, 0.001);
  camera.far = dist * 100;
  camera.position.set(c.x + dist * 0.55, c.y + dist * 0.4, c.z + dist * 0.73);
  camera.updateProjectionMatrix();
  controls.target.copy(c);
  controls.update();
}

// ── リサイズ・描画ループ ─────────────────────────────────────────────────────

function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== w || canvas.height !== h) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    lineMaterials.forEach((m) => m.resolution.set(w, h));
    invalidate();
  }
}
window.addEventListener('resize', resize);

renderer.setAnimationLoop(() => {
  resize();
  controls.update();   // 操作・慣性減衰中はchangeイベント経由でinvalidateされる
  if (needsRender) {
    needsRender = false;
    renderer.render(scene, camera);
  }
});

// ── UIイベント ───────────────────────────────────────────────────────────────

$('btn-solid').addEventListener('click', () => setCulling(false));
$('btn-culling').addEventListener('click', () => setCulling(true));
$('btn-bg-dark').addEventListener('click', () => setBackground('dark'));
$('btn-bg-light').addEventListener('click', () => setBackground('light'));
$('btn-reset').addEventListener('click', resetView);

function setMouseMode(mode) {
  mouseMode = mode;
  localStorage.setItem('cavev_mouse', mode);
  applyMouseMode();
}
$('btn-mouse-standard').addEventListener('click', () => setMouseMode('standard'));
$('btn-mouse-studio').addEventListener('click', () => setMouseMode('studio'));

$('btn-collapse').addEventListener('click', () => {
  const body = $('panel-body');
  const collapsed = body.classList.toggle('hidden');
  $('btn-collapse').textContent = collapsed ? '+' : '−';
});

function setLang(l) {
  lang = l;
  localStorage.setItem('cavev_lang', l);
  applyI18n();
}
$('btn-lang-ja').addEventListener('click', () => setLang('ja'));
$('btn-lang-en').addEventListener('click', () => setLang('en'));

// ファイル選択・ドラッグ&ドロップ（ローカルファイル読み込み）
$('file-input').addEventListener('change', (e) => {
  if (e.target.files && e.target.files[0]) loadFromFile(e.target.files[0]);
});
window.addEventListener('dragover', (e) => {
  e.preventDefault();
  document.body.classList.add('dragover');
});
window.addEventListener('dragleave', () => document.body.classList.remove('dragover'));
window.addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('dragover');
  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
    loadFromFile(e.dataTransfer.files[0]);
  }
});

// ── 起動 ─────────────────────────────────────────────────────────────────────

// URLパラメータ: file / mode(solid|culling) / bg(dark|light) / lang(ja|en) / mouse(standard|studio)
const params = new URLSearchParams(location.search);

const langParam = params.get('lang');
if (langParam === 'ja' || langParam === 'en') lang = langParam;
const mouseParam = params.get('mouse');
if (mouseParam === 'studio' || mouseParam === 'standard') mouseMode = mouseParam;
applyMouseMode();
applyI18n();

if (touchOnly) hide('section-mouse');

if (params.get('bg') === 'light') setBackground('light');
if (params.get('mode') === 'culling') setCulling(true);

resize();

const fileParam = params.get('file');
if (fileParam) {
  loadFromUrl(fileParam);
} else {
  show('landing');
}
