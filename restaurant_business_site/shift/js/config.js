/*
 * Shift Sync - 設定ファイル
 * このファイルだけを編集すれば施設に合わせてカスタマイズできます。
 */
window.SHIFT_CONFIG = {
  // Google Apps Script のWebアプリURL。
  // 空文字 = デモモード(このブラウザ内にのみ保存され、端末間では共有されません)
  // 本番運用する場合は SETUP.md の手順でGASをデプロイし、そのURLをここに設定してください。
  GAS_URL: "",

  // 管理画面の簡易PIN(SHA-256ハッシュの16進文字列)。空 = PINゲート無効。
  // 例: PIN「1234」なら "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4"
  // ※これは誤操作防止であり、セキュリティ保護ではありません(SETUP.md参照)
  ADMIN_PIN_HASH: "",

  // 施設名(画面ヘッダーに表示)
  STORE_NAME: "サンプル学童クラブ",

  // 週の開始曜日(0=日曜, 1=月曜)
  WEEK_STARTS_ON: 1,

  // 時刻微調整の刻み(分)
  TIME_STEP_MIN: 15,

  // 時刻微調整の可動域(時)
  OPEN_HOUR: 8,
  CLOSE_HOUR: 19,

  // 時間帯ブロック(スタッフがタップで選ぶ選択肢)
  // 学童向け: 学校がある日は「午後」、長期休みは「午前/1日」も使う想定
  BLOCKS: [
    { id: "am",   label: "午前", start: "08:30", end: "13:00" },
    { id: "pm",   label: "午後", start: "13:00", end: "19:00" },
    { id: "full", label: "1日",  start: "08:30", end: "19:00" }
  ],

  // 時間帯ごとの必要人数(管理画面の過不足表示に使用)
  TARGET_HEADCOUNT: { am: 2, pm: 3 },

  // 提出締切の案内文(表示のみ。入力を強制的に締め切ることはしません)
  SUBMIT_DEADLINE_TEXT: "希望の提出は毎週木曜まで",

  // trueにすると、スタッフが名前選択画面で自分の名前を登録できるようになります
  ALLOW_SELF_REGISTER: false
};
