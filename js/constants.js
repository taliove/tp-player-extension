// Teleport RDP Web Player — Constants
var TPP = {};

TPP.escapeHtml = function(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};

TPP.MAGIC_TPPR = 0x52505054;
TPP.HEADER_VER = 4;
TPP.TPPR_TYPE_RDP = 0x0101;
TPP.TPR_SIZE = 512;
TPP.HEADER_BASIC_OFFSET = 64;

TPP.TYPE_RDP_POINTER = 0x12;
TPP.TYPE_RDP_IMAGE = 0x13;
TPP.TYPE_RDP_KEYFRAME = 0x14;

TPP.RDP_IMG_RAW = 0;
TPP.RDP_IMG_BMP = 1;
TPP.RDP_IMG_ALT = 2;

TPP.PKG_HEADER_SIZE = 12;
TPP.IMAGE_INFO_SIZE = 24;
TPP.KEYFRAME_INFO_SIZE = 12;

TPP.MAX_RETRIES = 3;
TPP.RETRY_DELAY_MS = 1000;
TPP.FETCH_TIMEOUT_MS = 30000;
TPP.TICK_MS = 33;
TPP.SILENCE_THRESHOLD_MS = 1000;
TPP.LE = true;

// --- AI Analysis Constants (Three-Layer Architecture) ---
TPP.AI_L1_FRAMES = 8;            // uniform sample count for L1
TPP.AI_L2_FRAMES_PER_PHASE = 5;  // max frames per phase in L2
TPP.AI_L3_FRAMES_PER_CHECK = 3;  // max frames per deep check in L3
TPP.AI_MAX_CONCURRENT = 2;       // max parallel AI calls
TPP.AI_SKIP_RATIO = 0.1;         // skip first 10% of recording
TPP.AI_EXPORT_MAX_WIDTH = 800;
TPP.AI_JPEG_QUALITY = 0.4;
