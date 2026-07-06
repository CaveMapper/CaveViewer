# CaveMapper Viewer

CaveMapperStudio からエクスポートした `.cavev` ファイル（実体は glTF 2.0 バイナリ）を
Webブラウザーで閲覧するビューアー。Three.js 製・ビルド工程なしの静的サイト。

## デプロイ

このフォルダ（`viewer/`）を丸ごと静的Webサーバーにアップロードするだけで動作する。
npm等のビルドは不要（Three.js は `lib/` に同梱済み・外部CDN非依存）。

```
https://<ホスト>/viewer/                          … ランディング（ファイル選択/D&D）
https://<ホスト>/viewer/?file=<cavevのURL>        … 指定ファイルを読み込んで起動
```

`?file=` の例（同一サーバーの `data/` に置いた場合）:

```
https://example.com/viewer/?file=../data/banba_test02.cavev
https://example.com/viewer/?file=https://example.com/data/banba_test02.cavev
```

### 注意事項

- **CORS**: cavevファイルをビューアーと同一オリジンに置く場合は設定不要。
  別オリジンから読む場合は、cavev側サーバーに `Access-Control-Allow-Origin` が必要
- **MIME**: `.cavev` は未知拡張子として `application/octet-stream` で配信されれば十分
  （fetchでバイナリ取得するためMIME型は問わない）

## ローカルでの動作確認

リポジトリルートで簡易HTTPサーバーを立てる:

```
python -m http.server 8000
```

ブラウザーで開く:

```
http://localhost:8000/viewer/?file=../docs/banba_test02.cavev
```

または `http://localhost:8000/viewer/` を開き、.cavevファイルをドラッグ＆ドロップする。

## 機能

- オービット回転・パン・ズーム（マウス/タッチ対応）
- 洞窟メッシュのソリッド／カリング表示切替
  （カリング＝片面描画。法線が内向きのため手前の壁が透けて内部が見える）
- 注記オブジェクトの種類ごと表示/非表示（ファイルに含まれる種別のみ表示。
  人間は立ち/匍匐を1トグルに統合）
- 測線の総延長・距離計測の寸法値をスクリーン固定サイズのラベルで表示
  （ジオメトリから算出。黒地半透明＋白文字で背景モードに依存しない）。
  測線はセグメント毎の長さも総延長の半分サイズで表示（2セグメント以上のとき）。
  測線の数値ラベルはカリング表示中のみ表示（ソリッドでは線自体が外壁に隠れるため）
- カメラ操作終了時にスクリーン中央レイキャストで回転中心を自動更新
  （Studioの「Rotate Around Selection」相当・視界はジャンプしない）
- マウス操作モード切替: 標準（左ドラッグ回転/右ドラッグ移動）と
  Studio（中ドラッグ回転/Shift+中=移動/Ctrl+中=ドリー。CaveMapperStudioと同じ）
- 背景 ダーク/ライト切替。黒系注記（スケールバー・方角・引出線・矢尻）は
  ダークで白／ライトで黒に、ノート/スケールの文字テクスチャも白/黒に連動
- 日本語/英語UI切替（選択はlocalStorageに保存）
- 測線・寸法線（GLTFのLINESプリミティブ）はピクセル幅指定のfat lineで描画
- cavevメタデータ（`extras.cavemapper`）のformat/バージョン検査と警告表示
- URLパラメータ: `file` / `mode=culling` / `bg=light` / `lang=en|ja` / `mouse=studio|standard`
- ラベルテクスチャ・黒系注記はアンリット材質に変換して描画
  （ライティング材質のままだと法線の向きで白が灰色に沈むため）

## 構成

```
viewer/
  index.html      エントリポイント（importmap定義）
  main.js         ビューアー本体
  style.css       スタイル
  lib/            Three.js 0.180.0 同梱（MITライセンス: THREE-LICENSE.txt）
    three.module.js / three.core.js
    addons/loaders/GLTFLoader.js
    addons/controls/OrbitControls.js
    addons/lines/LineSegments2.js ほか（fat line描画）
    addons/utils/BufferGeometryUtils.js
```

フォーマット仕様・ノード識別タグ（`cm_kind`/`cm_type`/`cm_part`）の定義は
リポジトリの `docs/cavev_spec.md` を参照。

## デスクトップ（ローカル）ビューアー

このフォルダはローカルビューアーからもそのまま読み込まれる
（`ui/cavev_viewer.py` がローカルHTTPサーバー（127.0.0.1）で配信し、
既定ブラウザで開く）。ここを修正するとWeb版・ローカル版の両方に反映される。

- Studioから: ファイルメニュー「ビューアーで.cavevを開く...」
- 独立起動: `python cavev_viewer_main.py [file.cavev]`（最終アクセスから30分で自動終了）
