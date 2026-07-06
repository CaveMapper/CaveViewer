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

// 注記種別（cm_type）の表示順
const ANNOTATION_TYPES = [
  'rope', 'note', 'survey', 'distance',
  'scale', 'direction', 'stand', 'crawl',
];

// ── i18n ─────────────────────────────────────────────────────────────────────

const STRINGS = {
  ja: {
    view_mode: '洞窟メッシュ表示',
    solid: 'ソリッド',
    culling: 'カリング',
    annotations: '注記表示',
    background: '背景',
    dark: 'ダーク',
    light: 'ライト',
    reset_view: '視点リセット',
    loading: '読み込み中…',
    load_error: 'ファイルを読み込めませんでした',
    not_cavev: 'cavev形式ではないファイルです（表示を試みます）',
    newer_version: '新しいバージョンのcavevファイルです。表示が不完全な可能性があります',
    no_cave: '洞窟メッシュが含まれていません',
    open_prompt: '.cavevファイルをここにドラッグ＆ドロップ するか',
    open_file: 'ファイルを選択',
    hint: '左ドラッグ: 回転　　右ドラッグ: 移動　　ホイール: ズーム',
    lang_button: 'English',
    type_rope: 'ロープ',
    type_note: 'ノート',
    type_survey: '測線',
    type_distance: '距離計測',
    type_scale: 'スケールバー',
    type_direction: '方角',
    type_stand: '人間（立ち）',
    type_crawl: '人間（匍匐）',
  },
  en: {
    view_mode: 'Cave mesh display',
    solid: 'Solid',
    culling: 'Culling',
    annotations: 'Annotations',
    background: 'Background',
    dark: 'Dark',
    light: 'Light',
    reset_view: 'Reset view',
    loading: 'Loading…',
    load_error: 'Failed to load the file',
    not_cavev: 'Not a cavev file (attempting to display anyway)',
    newer_version: 'This cavev file uses a newer format version; display may be incomplete',
    no_cave: 'No cave mesh found in this file',
    open_prompt: 'Drag & drop a .cavev file here, or',
    open_file: 'Choose file',
    hint: 'Left drag: rotate    Right drag: pan    Wheel: zoom',
    lang_button: '日本語',
    type_rope: 'Rope',
    type_note: 'Note',
    type_survey: 'Survey line',
    type_distance: 'Distance',
    type_scale: 'Scale bar',
    type_direction: 'Direction',
    type_stand: 'Human (standing)',
    type_crawl: 'Human (crawling)',
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
  document.getElementById('btn-lang').textContent = t('lang_button');
  document.documentElement.lang = lang;
  // 注記チェックボックスのラベルを更新
  document.querySelectorAll('#anno-toggles label span').forEach((el) => {
    el.textContent = t(`type_${el.dataset.type}`);
  });
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

// ── シーン状態 ────────────────────────────────────────────────────────────────

let modelRoot = null;              // 読み込んだ glTF シーン
let caveMaterials = [];            // 洞窟メッシュのマテリアル（カリング切替対象）
let typeGroups = {};               // cm_type → 種別グループ Object3D
let lineMaterials = [];            // fat line マテリアル（解像度・色更新対象）
let fitSphere = null;              // 視点リセット用バウンディング球
let cullingMode = false;

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

  // cavemapperメタデータ検査（glTFトップレベルextras）
  const meta = gltf.parser.json.extras && gltf.parser.json.extras.cavemapper;
  if (!meta || meta.format !== 'cavev') {
    showWarn(t('not_cavev'));
  } else if (meta.format_version > SUPPORTED_FORMAT_VERSION) {
    showWarn(t('newer_version'));
  }

  modelRoot = gltf.scene;
  scene.add(modelRoot);

  // ── ノード走査: 種別グループ・洞窟メッシュ・ラインを収集 ──────────────
  const caveMeshes = [];
  const lineObjects = [];
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
  });

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
  lineObjects.forEach((line) => replaceWithFatLine(line));

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

  $('file-name').textContent = displayName;
  document.title = `${displayName} — CaveMapper Viewer`;
  show('panel');
  show('hint');
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
  if (!posAttr) return;

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
  if (positions.length < 6) return;

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
}

// ── 注記チェックボックス ──────────────────────────────────────────────────────

function buildAnnotationToggles() {
  const holder = $('anno-toggles');
  holder.innerHTML = '';
  ANNOTATION_TYPES.forEach((type) => {
    const group = typeGroups[type];
    if (!group) return;   // ファイルに存在しない種別は表示しない
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.addEventListener('change', () => { group.visible = cb.checked; });
    const span = document.createElement('span');
    span.dataset.type = type;
    span.textContent = t(`type_${type}`);
    label.append(cb, span);
    holder.appendChild(label);
  });
}

// ── 表示モード（ソリッド/カリング）──────────────────────────────────────────

function applyCulling() {
  // 洞窟メッシュの法線は内向き（cavev仕様）。FrontSide描画にすると
  // カメラ側の壁がカリングされ、外から洞窟内部が透けて見える。
  const side = cullingMode ? THREE.FrontSide : THREE.DoubleSide;
  caveMaterials.forEach((m) => { m.side = side; });
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
  $('btn-bg-dark').classList.toggle('active', mode === 'dark');
  $('btn-bg-light').classList.toggle('active', mode === 'light');
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
  }
}
window.addEventListener('resize', resize);

renderer.setAnimationLoop(() => {
  resize();
  controls.update();
  renderer.render(scene, camera);
});

// ── UIイベント ───────────────────────────────────────────────────────────────

$('btn-solid').addEventListener('click', () => setCulling(false));
$('btn-culling').addEventListener('click', () => setCulling(true));
$('btn-bg-dark').addEventListener('click', () => setBackground('dark'));
$('btn-bg-light').addEventListener('click', () => setBackground('light'));
$('btn-reset').addEventListener('click', resetView);

$('btn-collapse').addEventListener('click', () => {
  const body = $('panel-body');
  const collapsed = body.classList.toggle('hidden');
  $('btn-collapse').textContent = collapsed ? '+' : '−';
});

$('btn-lang').addEventListener('click', () => {
  lang = lang === 'ja' ? 'en' : 'ja';
  localStorage.setItem('cavev_lang', lang);
  applyI18n();
});

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

// URLパラメータ: file / mode(solid|culling) / bg(dark|light) / lang(ja|en)
const params = new URLSearchParams(location.search);

const langParam = params.get('lang');
if (langParam === 'ja' || langParam === 'en') lang = langParam;
applyI18n();

if (params.get('bg') === 'light') setBackground('light');
if (params.get('mode') === 'culling') setCulling(true);

resize();

const fileParam = params.get('file');
if (fileParam) {
  loadFromUrl(fileParam);
} else {
  show('landing');
}
