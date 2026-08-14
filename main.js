import {
	calculateChaos,
	calculateDuration,
	calculatePepeness,
	createDistanceTravelledTrait,
	createNumberOfStrokesTrait,
	createVarietyTrait,
} from "./traits.js";

// It's PEPEPAINT v1 first uploaded on 7th Oct 2025

/**
 * PEPEPAINT
 * A generative art tool for creating Pepe-themed paintings.
 * Features include:
 * - Multiple brush types and sizes
 * - A palette of Pepe-themed colors
 * - Layer management with blending modes
 * - Randomization options for brushes, colors, and effects
 * - Export options for saving and sharing artwork
 * Author: Nathan Gregg
 * License: MIT License
 */

////////////////////
//      NAV       //
////////////////////

const gallery_button = document.getElementById("gallery_button");
const submission_button = document.getElementById("submission_button");
const new_canvas_button = document.getElementById("new_canvas_button");
const submission_dialog = document.getElementById("submission_dialog");
const submission_form = document.getElementById("submission_form");
const submission_status = document.getElementById("submission_status");
const submission_close_button = document.getElementById("submission_close_button");
const submission_cancel_button = document.getElementById("submission_cancel_button");
const submission_submit_button = document.getElementById("submission_submit_button");
let latest_submission_traits = null;
let pending_submission_id = null;

// GALLERY BUTTON
gallery_button?.addEventListener("click", () => {
	window.open("https://objkt.com/users/tz1QQkaUxPXKdpkPYe4w999wF9Abggicdad5/created", "_blank", "noopener,noreferrer");
});

submission_button?.addEventListener("click", () => {
	if (!submission_dialog.open) {
		submission_dialog.show();
	}
});

new_canvas_button?.addEventListener("click", async () => {
	const should_start_new = window.confirm("Start a new canvas? Your current locally saved canvas will be cleared.");
	if (should_start_new) {
		await resetCanvas();
	}
});

[submission_close_button, submission_cancel_button].forEach((button) => {
	button?.addEventListener("click", () => submission_dialog.close());
});

submission_form?.addEventListener("input", () => {
	pending_submission_id = null;
});

function calculateSubmissionTraits(canvas, ended_at = Date.now()) {
	const duration_trait = calculateDuration(artwork_started_at, ended_at);
	return {
		pepeness: calculatePepeness(canvas).value,
		number_of_strokes: createNumberOfStrokesTrait(number_of_strokes).value,
		duration: duration_trait.formatted,
		quietus: duration_trait.quietus,
		distance_travelled: createDistanceTravelledTrait(pointer_distance_travelled, draw_canvas.width, draw_canvas.height).value,
		chaos: calculateChaos(canvas).value,
		variety: createVarietyTrait(brush_usage).value,
	};
}

function getPublicTraits() {
	const values = calculateSubmissionTraits(createFlattenedCanvas());
	return {
		"Croakage (%)": values.pepeness,
		"RSi (num)": values.number_of_strokes,
		"Quietus (%)": values.quietus,
		"Wanderlust (px)": values.distance_travelled,
		Cows: values.chaos,
		"Brushiness (num)": values.variety,
	};
}

submission_form?.addEventListener("submit", async (event) => {
	event.preventDefault();
	if (!submission_form.reportValidity()) return;

	submission_submit_button.disabled = true;
	if (submission_status) submission_status.textContent = "Status: Preparing submission…";

	try {
		const submission_canvas = createFlattenedCanvas();
		const submitted_at = Date.now();
		latest_submission_traits = calculateSubmissionTraits(submission_canvas, submitted_at);

		const artwork = await createSubmissionArtwork();
		pending_submission_id ||= crypto.randomUUID();
		const submission_data = new FormData(submission_form);
		submission_data.set("submission_id", pending_submission_id);
		submission_data.set("traits", JSON.stringify(latest_submission_traits));
		submission_data.set("artwork", artwork.blob, artwork.filename);

		if (submission_status) submission_status.textContent = "Status: Sending submission…";
		const response = await fetch("/api/submissions", { method: "POST", body: submission_data });
		const result = await response.json().catch(() => ({}));
		if (!response.ok) {
			throw new Error(result.error || "The submission could not be delivered.");
		}

		const submitted_id = pending_submission_id;
		pending_submission_id = null;
		submission_form.reset();
		console.info("PEPEPAINT submission sent", { submission_id: submitted_id, traits: latest_submission_traits });
		if (submission_status) submission_status.textContent = `Status: Submitted successfully · ${submitted_id}`;
	} catch (error) {
		console.error("PEPEPAINT submission failed.", error);
		if (submission_status) submission_status.textContent = `Status: ${error.message}`;
	} finally {
		submission_submit_button.disabled = false;
	}
});

/////////////////////
//     HELPERS     //
/////////////////////

function getRandomInt(min, max) {
	// min = Math.ceil(min);
	// max = Math.floor(max);
	if (min > max) {
		[min, max] = [max, min];
	}
	let value = Math.floor(Math.random() * (max - min + 1)) + min;
	return value;
}

function getRandomFloat(min, max, decimals = 3) {
	const value = Math.random() * (max - min) + min;
	const factor = Math.pow(10, decimals);
	return Math.round(value * factor) / factor;
}

function getRandomBoolean(chance = 0.5) {
	return Math.random() < chance;
}

const feedback_dialog = document.getElementById("feedback_dialog");
const feedback_text = document.getElementById("feedback_text");
let feedback_timeout_id = null;

function showFeedbackNotification(message) {
	if (!feedback_dialog || !feedback_text) return;

	feedback_text.textContent = message;
	feedback_dialog.classList.add("visible");

	if (feedback_timeout_id !== null) {
		clearTimeout(feedback_timeout_id);
	}

	feedback_timeout_id = setTimeout(() => {
		feedback_dialog.classList.remove("visible");
		feedback_timeout_id = null;
	}, 2000);
}

function showEffectToggleNotification(effectName, enabled) {
	showFeedbackNotification(`${effectName}: ${enabled ? "On" : "Off"}`);
}

function getSavedRotateAngle() {
	const rotateInput = document.getElementById("rotate_angle_input_number");
	if (rotateInput && rotateInput.value !== undefined) {
		const parsed = Number.parseInt(rotateInput.value, 10);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}

	return Number.isFinite(rotate_angle) ? rotate_angle : 0;
}

function getWeightedGradientStopCount() {
	const stop_count_weights = [
		{ count: 2, weight: 1 },
		{ count: 3, weight: 8 },
		{ count: 4, weight: 3 },
		{ count: 5, weight: 2 },
		{ count: 6, weight: 1 },
		{ count: 7, weight: 1 },
		{ count: 8, weight: 1 },
	];

	const total_weight = stop_count_weights.reduce((sum, item) => sum + item.weight, 0);
	let roll = Math.random() * total_weight;

	for (const item of stop_count_weights) {
		roll -= item.weight;
		if (roll < 0) return item.count;
	}

	return 3;
}

function invert_val(num, min, max) {
	return max + min - num;
}

// Function to calculate the angle from a direction vector
function getAngleFromVector(vector) {
	return Math.atan2(vector.y, vector.x);
}

// Function to interpolate between vectors
function interpolateVector(target, current, factor) {
	return {
		x: current.x + (target.x - current.x) * factor,
		y: current.y + (target.y - current.y) * factor,
	};
}

// Normalize a vector
function normalizeVector(vector) {
	const length = Math.sqrt(vector.x * vector.x + vector.y * vector.y);
	return length === 0 ? { x: 1, y: 0 } : { x: vector.x / length, y: vector.y / length };
}

// Utility function to compute the mirror origin (in pixels)
function getMirrorOrigin() {
	return {
		x: window_w * (mirror_origin_x / 100),
		y: window_h * (mirror_origin_y / 100),
	};
}

// Rotate a point (x, y) about the given origin by theta radians.
function rotatePoint(x, y, origin, theta) {
	const dx = x - origin.x;
	const dy = y - origin.y;
	const cosTheta = Math.cos(theta);
	const sinTheta = Math.sin(theta);
	return {
		x: origin.x + dx * cosTheta - dy * sinTheta,
		y: origin.y + dx * sinTheta + dy * cosTheta,
	};
}

// Reflect a point (x, y) about a line through the mirror origin at a given angle.
function reflectPoint(x, y, angle) {
	const origin = getMirrorOrigin();
	const dx = x - origin.x;
	const dy = y - origin.y;
	const cos2 = Math.cos(2 * angle);
	const sin2 = Math.sin(2 * angle);
	return {
		x: origin.x + dx * cos2 + dy * sin2,
		y: origin.y + dx * sin2 - dy * cos2,
	};
}

function updateTabPreviewSizes() {
	return;
}

function lerp(a, b, t) {
	return a + (b - a) * t;
}

// Interpolates hue angle properly (wraps around 360°)
function lerpAngle(h1, h2, t) {
	let delta = ((h2 - h1 + 360 + 180) % 360) - 180;
	return (h1 + delta * t + 360) % 360;
}

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

const clamp01 = (v) => Math.max(0, Math.min(1, v));

const clampPct = (p) => Math.max(0, Math.min(100, p));

/////////////////////
//     COLOURS     //
/////////////////////
const color_palette_seed_gradients = [
	// Reds gradient
	"#ffcccc",
	"#ff9999",
	"#ff6666",
	"#ff3333",
	"#ff0000",
	"#cc0000",

	// Oranges gradient
	"#ffebcc",
	"#ffd699",
	"#ffc266",
	"#ffad33",
	"#ff9900",
	"#cc7a00",

	// Browns gradient
	"#f2d6cc",
	"#e6b399",
	"#d99966",
	"#cc8033",
	"#bf6600",
	"#994d00",

	// Yellows gradient
	"#ffffcc",
	"#ffff99",
	"#ffff66",
	"#ffff33",
	"#ffff00",
	"#cccc00",

	// Greens gradient
	"#ccffcc",
	"#99ff99",
	"#66ff66",
	"#33cc33",
	"#00cc00",
	"#009900",

	// Blues gradient
	"#cce5ff",
	"#99ccff",
	"#66b3ff",
	"#3399ff",
	"#007fff",
	"#0066cc",

	// Purples gradient
	"#e6ccff",
	"#cc99ff",
	"#b366ff",
	"#9933ff",
	"#6600cc",
	"#4d0099",

	// Monochrome gradient from white to black
	"#ffffff",
	"#cccccc",
	"#999999",
	"#666666",
	"#333333",
	"#000000",
];

const color_palette_seed_shortlist = [
	"#FFFFFF",
	"#D3D3D3",
	"#A9A9A9",
	"#696969",
	"#000000", // monochrome
	"#FFE4E1",
	"#FFA07A",
	"#FF0000",
	"#DC143C",
	"#8B0000", // reds
	"#FFE4B5",
	"#F4A460",
	"#FFA500",
	"#FF8C00",
	"#FF4500", // oranges
	"#FFFACD",
	"#EEE8AA",
	"#DAA520",
	"#FFFF00",
	"#BDB76B", // yellows
	"#F0FFF0",
	"#98FB98",
	"#7FFF00",
	"#3CB371",
	"#008000",
	"#006400", // greens
	"#E0FFFF",
	"#40E0D0",
	"#00FFFF",
	"#1E90FF",
	"#0000FF",
	"#000080", // blues
	"#E6E6FA",
	"#EE82EE",
	"#FF00FF",
	"#8A2BE2",
	"#800080",
	"#4B0082", // purples
	"#D2B48C",
	"#CD853F",
	"#8B4513",
	"#A52A2A",
	"#800000", // browns
];

function getColor() {
	let seed_no = getRandomInt(0, color_palette_seed_shortlist.length - 1);
	let color_hex = color_palette_seed_shortlist[seed_no];
	return color_hex;
}

function parseHSL(hslString) {
	const match = hslString.match(/hsl\((\d+),\s*([\d.]+)%,\s*([\d.]+)%\)/);
	if (!match) return [0, 0, 0];
	return [parseFloat(match[1]), parseFloat(match[2]) / 100, parseFloat(match[3]) / 100];
}

// Helper function to convert a CSS color name to RGBA with a specified alpha
function cssColorToRgba(colorName) {
	const tempElement = document.createElement("div");
	tempElement.style.color = colorName;
	document.body.appendChild(tempElement);

	const computedColor = getComputedStyle(tempElement).color;
	document.body.removeChild(tempElement);

	// computedColor is in "rgb(r, g, b)" or "rgba(r, g, b, a)" format.
	const rgbValues = computedColor.match(/\d+/g); // Extract numeric values

	const r = parseInt(rgbValues[0], 10);
	const g = parseInt(rgbValues[1], 10);
	const b = parseInt(rgbValues[2], 10);

	return [r, g, b];
}

function hexToRgba(hex) {
	// Remove the leading '#' if present
	hex = hex.replace(/^#/, "");

	// Parse the hex color
	let r = parseInt(hex.substring(0, 2), 16);
	let g = parseInt(hex.substring(2, 4), 16);
	let b = parseInt(hex.substring(4, 6), 16);

	// Return the rgba color
	return [r, g, b];
}

// HSL to RGB conversion (returns r, g, b in 0–255)
function hslToRgb(h, s, l) {
	h = h % 360;
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const hp = h / 60;
	const x = c * (1 - Math.abs((hp % 2) - 1));
	let r = 0,
		g = 0,
		b = 0;

	if (hp >= 0 && hp < 1) [r, g, b] = [c, x, 0];
	else if (hp < 2) [r, g, b] = [x, c, 0];
	else if (hp < 3) [r, g, b] = [0, c, x];
	else if (hp < 4) [r, g, b] = [0, x, c];
	else if (hp < 5) [r, g, b] = [x, 0, c];
	else if (hp < 6) [r, g, b] = [c, 0, x];

	const m = l - c / 2;
	return {
		r: Math.round((r + m) * 255),
		g: Math.round((g + m) * 255),
		b: Math.round((b + m) * 255),
	};
}

function hslToRGB(h, s, l) {
	s /= 100;
	l /= 100;

	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = l - c / 2;

	let r1, g1, b1;
	if (h < 60) [r1, g1, b1] = [c, x, 0];
	else if (h < 120) [r1, g1, b1] = [x, c, 0];
	else if (h < 180) [r1, g1, b1] = [0, c, x];
	else if (h < 240) [r1, g1, b1] = [0, x, c];
	else if (h < 300) [r1, g1, b1] = [x, 0, c];
	else [r1, g1, b1] = [c, 0, x];

	return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
}

function rgbToHSL(r, g, b) {
	r /= 255;
	g /= 255;
	b /= 255;
	const max = Math.max(r, g, b),
		min = Math.min(r, g, b);
	let h,
		s,
		l = (max + min) / 2;

	if (max === min) {
		h = s = 0; // achromatic
	} else {
		const d = max - min;
		s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
		switch (max) {
			case r:
				h = (g - b) / d + (g < b ? 6 : 0);
				break;
			case g:
				h = (b - r) / d + 2;
				break;
			case b:
				h = (r - g) / d + 4;
				break;
		}
		h /= 6;
	}
	return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function getRandomHexColor() {
	// Generate a random number between 0 and 0xFFFFFF, then convert it to a hexadecimal string
	const randomColor = Math.floor(Math.random() * 0xffffff).toString(16);
	// Pad with zeros if necessary to ensure the color has 6 characters
	return `#${randomColor.padStart(6, "0")}`;
}

function hexToHSL(hex) {
	let r = parseInt(hex.slice(1, 3), 16) / 255;
	let g = parseInt(hex.slice(3, 5), 16) / 255;
	let b = parseInt(hex.slice(5, 7), 16) / 255;

	let max = Math.max(r, g, b),
		min = Math.min(r, g, b);
	let h,
		s,
		l = (max + min) / 2;

	if (max === min) {
		h = s = 0; // achromatic
	} else {
		let d = max - min;
		s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
		switch (max) {
			case r:
				h = (g - b) / d + (g < b ? 6 : 0);
				break;
			case g:
				h = (b - r) / d + 2;
				break;
			case b:
				h = (r - g) / d + 4;
				break;
		}
		h /= 6;
	}

	return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

// Helper: build a CSS color with embedded alpha from any of your 3 formats
function getFillColorWithAlpha(fill_color, alphaPct) {
	const a = clamp(alphaPct, 0, 100) / 100;

	if (typeof fill_color === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(fill_color)) {
		// hex -> rgba
		let hex = fill_color.slice(1);
		if (hex.length === 3)
			hex = hex
				.split("")
				.map((ch) => ch + ch)
				.join("");
		const r = parseInt(hex.slice(0, 2), 16);
		const g = parseInt(hex.slice(2, 4), 16);
		const b = parseInt(hex.slice(4, 6), 16);
		return `rgba(${r}, ${g}, ${b}, ${a})`;
	}

	if (Array.isArray(fill_color_rgb) && fill_color_rgb.length === 3) {
		const [r, g, b] = fill_color_rgb.map((v) => clamp(v, 0, 255));
		return `rgba(${r}, ${g}, ${b}, ${a})`;
	}

	if (Array.isArray(fill_color_hsl) && fill_color_hsl.length === 3) {
		const [h, s, l] = [fill_color_hsl[0], clamp(fill_color_hsl[1], 0, 100), clamp(fill_color_hsl[2], 0, 100)];
		return `hsla(${h}, ${s}%, ${l}%, ${a})`;
	}

	// Fallback
	return `rgba(0, 0, 0, ${a})`;
}

/////////////////////
//     SAVING      //
/////////////////////
Date.prototype.today = function () {
	return (this.getDate() < 10 ? "0" : "") + this.getDate() + "/" + (this.getMonth() + 1 < 10 ? "0" : "") + (this.getMonth() + 1) + "/" + this.getFullYear();
};

// For the time now
Date.prototype.timeNow = function () {
	return (
		(this.getHours() < 10 ? "0" : "") +
		this.getHours() +
		":" +
		(this.getMinutes() < 10 ? "0" : "") +
		this.getMinutes() +
		":" +
		(this.getSeconds() < 10 ? "0" : "") +
		this.getSeconds()
	);
};

function createFlattenedCanvas() {
	const offscreenCanvas = document.createElement("canvas");
	const offscreenCtx = offscreenCanvas.getContext("2d");
	offscreenCanvas.width = window_w;
	offscreenCanvas.height = window_h;
	offscreenCtx.imageSmoothingEnabled = true;
	offscreenCtx.globalAlpha = draw_canvas_data.opacity;
	offscreenCtx.drawImage(draw_canvas, 0, 0, window_w, window_h);

	return offscreenCanvas;
}

function getExportFileName(prefix = "PEPEPAINT") {
	const now = new Date();
	const iso_stamp = now.toISOString().replace(/[:.]/g, "-");
	return `${prefix}_${iso_stamp}.png`;
}

function downloadBlobAsImage(blob, fileName) {
	const downloadLink = document.createElement("a");
	downloadLink.setAttribute("download", fileName);
	const url = URL.createObjectURL(blob);
	downloadLink.setAttribute("href", url);
	downloadLink.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function writeGifShort(bytes, value) {
	bytes.push(value & 0xff, (value >> 8) & 0xff);
}

function writeGifString(bytes, value) {
	for (let i = 0; i < value.length; i++) {
		bytes.push(value.charCodeAt(i));
	}
}

function getGifPaletteIndex(red, green, blue) {
	const r = red >> 5;
	const g = green >> 5;
	const b = blue >> 6;
	return (r << 5) | (g << 2) | b;
}

function writeGifSubBlocks(bytes, data) {
	for (let i = 0; i < data.length; i += 255) {
		const block = data.slice(i, i + 255);
		bytes.push(block.length, ...block);
	}
	bytes.push(0);
}

function encodeGifLzw(indexedPixels, minCodeSize = 8) {
	const clearCode = 1 << minCodeSize;
	const endCode = clearCode + 1;
	let codeSize = minCodeSize + 1;
	const output = [];
	let bitBuffer = 0;
	let bitCount = 0;

	function writeCode(code) {
		bitBuffer += code * Math.pow(2, bitCount);
		bitCount += codeSize;

		while (bitCount >= 8) {
			output.push(bitBuffer % 256);
			bitBuffer = Math.floor(bitBuffer / 256);
			bitCount -= 8;
		}
	}

	writeCode(clearCode);

	for (let i = 0; i < indexedPixels.length; i++) {
		writeCode(indexedPixels[i]);

		// Keep the stream at 9-bit literal codes. GIF decoders grow their
		// dictionaries while reading, so clear before they need 10-bit codes.
		if ((i + 1) % 250 === 0 && i < indexedPixels.length - 1) {
			writeCode(clearCode);
			codeSize = minCodeSize + 1;
		}
	}

	writeCode(endCode);

	if (bitCount > 0) {
		output.push(bitBuffer & 0xff);
	}

	return output;
}

function createGifBlob(frames, width, height, delayMs) {
	const bytes = [];
	const frameDelayMs = Number.isFinite(delayMs) ? delayMs : 100;
	const delay = Math.max(2, Math.round(frameDelayMs / 10));

	writeGifString(bytes, "GIF89a");
	writeGifShort(bytes, width);
	writeGifShort(bytes, height);
	bytes.push(0xf7, 0, 0);

	for (let r = 0; r < 8; r++) {
		for (let g = 0; g < 8; g++) {
			for (let b = 0; b < 4; b++) {
				bytes.push(Math.round((r / 7) * 255), Math.round((g / 7) * 255), Math.round((b / 3) * 255));
			}
		}
	}

	bytes.push(0x21, 0xff, 0x0b);
	writeGifString(bytes, "NETSCAPE2.0");
	bytes.push(3, 1);
	writeGifShort(bytes, 0);
	bytes.push(0);

	frames.forEach((frame) => {
		bytes.push(0x21, 0xf9, 4, 0);
		writeGifShort(bytes, delay);
		bytes.push(0, 0);

		bytes.push(0x2c);
		writeGifShort(bytes, 0);
		writeGifShort(bytes, 0);
		writeGifShort(bytes, width);
		writeGifShort(bytes, height);
		bytes.push(0);

		const indexedPixels = new Uint8Array(width * height);
		const data = frame.data;

		for (let i = 0, p = 0; i < data.length; i += 4, p++) {
			indexedPixels[p] = data[i + 3] === 0 ? 0 : getGifPaletteIndex(data[i], data[i + 1], data[i + 2]);
		}

		bytes.push(8);
		writeGifSubBlocks(bytes, encodeGifLzw(indexedPixels, 8));
	});

	bytes.push(0x3b);
	return new Blob([new Uint8Array(bytes)], { type: "image/gif" });
}

const submission_max_gif_frames = 32;

function createAnimatedCanvasGifBlob({ max_frames = Number.POSITIVE_INFINITY } = {}) {
	if (!window.pepepaint.canvas_animation_on || typeof window.pepepaint.renderAnimationFrameToCanvas !== "function") {
		return null;
	}

	const frameCanvas = document.createElement("canvas");
	const frameCtx = frameCanvas.getContext("2d", { willReadFrequently: true });
	frameCanvas.width = draw_canvas.width;
	frameCanvas.height = draw_canvas.height;
	const frames = [];
	const requested_frame_count = window.pepepaint.getAnimationGifFrameCount?.();
	const natural_frame_count = Number.isFinite(requested_frame_count) ? Math.max(2, Math.round(requested_frame_count)) : 10;
	const normalized_max_frames = Number.isFinite(max_frames) ? Math.max(2, Math.round(max_frames)) : natural_frame_count;
	const frame_count = Math.min(natural_frame_count, normalized_max_frames);

	for (let i = 0; i < frame_count; i++) {
		const hasFrame = window.pepepaint.renderAnimationFrameToCanvas(frameCtx, frameCanvas, {
			animation_progress: i / frame_count,
		});
		if (!hasFrame) return null;
		frames.push(frameCtx.getImageData(0, 0, frameCanvas.width, frameCanvas.height));
	}

	const natural_frame_delay = Math.max(20, Number.isFinite(window.animation_speed) ? window.animation_speed : 100);
	const frame_delay = natural_frame_delay * (natural_frame_count / frame_count);
	return createGifBlob(frames, frameCanvas.width, frameCanvas.height, frame_delay);
}

async function createSubmissionArtwork() {
	if (window.pepepaint.canvas_animation_on) {
		const gif_blob = createAnimatedCanvasGifBlob({ max_frames: submission_max_gif_frames });
		if (!gif_blob) throw new Error("Could not export the animated artwork as a GIF.");
		return { blob: gif_blob, filename: "artwork.gif" };
	}

	return { blob: await canvasToPngBlob(createFlattenedCanvas()), filename: "artwork.png" };
}

function getGifExportFileName(prefix = "PEPEPAINT") {
	const now = new Date();
	const iso_stamp = now.toISOString().replace(/[:.]/g, "-");
	return `${prefix}_${iso_stamp}.gif`;
}

function DownloadCanvasAsGif() {
	if (!window.pepepaint.canvas_animation_on || typeof window.pepepaint.renderAnimationFrameToCanvas !== "function") {
		DownloadCanvasAsPng();
		return;
	}

	const blob = createAnimatedCanvasGifBlob();
	if (!blob) {
		DownloadCanvasAsPng();
		return;
	}
	downloadBlobAsImage(blob, getGifExportFileName("PEPEPAINT"));
}

function DownloadCanvasAsPng() {
	const offscreenCanvas = createFlattenedCanvas();

	// Generate the file name
	const fileName = getExportFileName("PEPEPAINT");

	// Convert offscreen canvas to Blob and download
	offscreenCanvas.toBlob(function (blob) {
		if (!blob) {
			return;
		}
		downloadBlobAsImage(blob, fileName);
	});
}

function DownloadCanvasAsImage() {
	if (window.pepepaint.canvas_animation_on) {
		DownloadCanvasAsGif();
		return;
	}

	DownloadCanvasAsPng();
}

async function shareCanvasImage() {
	const offscreenCanvas = createFlattenedCanvas();
	const fileName = getExportFileName("PEPEPAINT");

	const blob = await new Promise((resolve, reject) => {
		offscreenCanvas.toBlob((result) => {
			if (!result) {
				reject(new Error("Failed to export image for sharing."));
				return;
			}
			resolve(result);
		}, "image/png");
	});

	const shareFile = new File([blob], fileName, { type: "image/png" });

	const supports_share_api = !!navigator.share;
	const can_share_files = !navigator.canShare || navigator.canShare({ files: [shareFile] });

	if (supports_share_api && can_share_files) {
		try {
			// Keep payload file-only for better iOS compatibility.
			await navigator.share({ files: [shareFile] });
			return;
		} catch (error) {
			if (error && error.name === "AbortError") {
				return;
			}
			console.warn("Share failed. Falling back to download.", error);
		}
	}

	downloadBlobAsImage(blob, fileName);
}

function downloadSeparateCanvases() {
	const d = new Date();
	const today = d.toLocaleDateString();
	const time_now = d.toLocaleTimeString();
	const tempCanvas = document.createElement("canvas");
	const tempCtx = tempCanvas.getContext("2d");
	tempCanvas.width = window_w;
	tempCanvas.height = window_h;
	tempCtx.imageSmoothingEnabled = true;
	tempCtx.drawImage(draw_canvas, 0, 0, window_w, window_h);

	const fileName = `PEPEPAINT_${today}@${time_now}_LAYER_0.png`;
	const downloadLink = document.createElement("a");
	downloadLink.setAttribute("download", fileName);

	tempCanvas.toBlob(function (blob) {
		const url = URL.createObjectURL(blob);
		downloadLink.setAttribute("href", url);
		downloadLink.click();
	});
}

//////////////////////
//    VARIABLES     //
//////////////////////
const window_w = 400;
const window_h = 560;
function syncPreviewCanvasToActiveCanvas() {
	if (!preview_canvas || !preview_ctx) {
		return;
	}

	setupMainCanvas(preview_canvas, preview_ctx);
}

function setupMainCanvas(canvas, context) {
	if (!canvas || !context) return;

	const width = Math.max(1, Math.round(window_w));
	const height = Math.max(1, Math.round(window_h));

	canvas.width = width;
	canvas.height = height;

	context.setTransform(1, 0, 0, 1, 0, 0);
	context.imageSmoothingEnabled = true;
}

let nav_preview_canvas_width = 40;
let nav_preview_canvas_height = 40;

let mousePos;
let x, y;
let px, py;
let isDrawing = false; // Variable to track if the mouse button is down

let constantlyUpdateOnMousedown = true;
let stop_drawing_on_mouse_out = false;

let preserve_merged_layers = true;

// Filters (for canvas)

// Brushes
let brush_type = "image";

let brush_width = 50;
let brush_height = 50;

let brush_width_float = brush_width;
let brush_height_float = brush_height;

let brush_size_increment_x = 1;
let brush_size_increment_y = 1;

// Image
let img;
let image_opacity = 100;
let image_array = [];
let image_index = 0;

function getImageBrushAlpha() {
	return clampPct(Number(image_opacity) || 0) / 100;
}

// BEHAVIOURS

// Randomiser
let randomiser_brush_type_on = false;
let randomiser_brush_settings_on = true;
let randomiser_behaviour_type_on = false;
let randomiser_behaviour_settings_on = false;

let randomiser_brush_size_on = true;
let randomiser_brush_size_min = 10;
let randomiser_brush_size_max = 300;

// Hard limits for the brush size selected by randAll().
let brush_size_rand_min = 10;
let brush_size_rand_max = 300;

// Drawing speed
let drawing_speed_on = false;
let drawing_frame_count = 0;
let drawing_speed = 1;

// Size
let brush_size_automation_on = false;
let brush_size_before_automation = null;
let randomise_lock_width_and_height = true;
let brush_width_random;
let randomise_width = true;
let random_walker_width = false;
let randomise_width_range = 40;
let randomise_width_speed = 2;
let randomise_width_easing = 0.5;

let brush_height_random;
let randomise_height = true;
let random_walker_height = false;
let randomise_height_range = 40;
let randomise_height_speed = 2;
let randomise_height_easing = 0.5;
// let break_coords = false;

// Follow
let follow_brush_direction = false;
let lastPos = null;
let smoothedDirection = { x: 1, y: 0 };

function getCurrentBrushSize() {
	const brushSizeInput = document.getElementById("brush_w_input_number");
	const parsed = Number.parseInt(brushSizeInput ? brushSizeInput.value : brush_height, 10);
	return Number.isFinite(parsed) ? parsed : brush_height;
}

function syncBrushSizeInputs() {
	const brushSizeRange = document.getElementById("brush_w_input_range");
	const brushSizeNumber = document.getElementById("brush_w_input_number");

	if (brushSizeRange) {
		brushSizeRange.value = brush_height;
	}
	if (brushSizeNumber) {
		brushSizeNumber.value = brush_height;
	}
}

function setBrushSizeAutomation(enabled) {
	const next_state = Boolean(enabled);

	if (next_state === brush_size_automation_on) {
		return;
	}

	if (next_state) {
		brush_size_before_automation = {
			width: brush_width,
			height: brush_height,
			width_float: brush_width_float,
			height_float: brush_height_float,
		};
	} else if (brush_size_before_automation) {
		brush_width = brush_size_before_automation.width;
		brush_height = brush_size_before_automation.height;
		brush_width_float = brush_size_before_automation.width_float;
		brush_height_float = brush_size_before_automation.height_float;
		syncBrushSizeInputs();
		brush_size_before_automation = null;
	}

	brush_size_automation_on = next_state;
}

function getActiveBrushAspectRatio() {
	const activeImage = image_array[Number.parseInt(image_index, 10)];
	if (!activeImage) {
		return 1;
	}

	const naturalWidth = activeImage.naturalWidth || activeImage.width;
	const naturalHeight = activeImage.naturalHeight || activeImage.height;
	if (!naturalWidth || !naturalHeight) {
		return 1;
	}

	return naturalWidth / naturalHeight;
}

function setBrushSizeFromHeight(size) {
	const nextHeight = Number.parseInt(size, 10);
	if (!Number.isFinite(nextHeight)) {
		return;
	}

	const nextWidth = Math.max(1, Math.round(nextHeight * getActiveBrushAspectRatio()));
	brush_width = nextWidth;
	brush_height = nextHeight;
	brush_width_float = nextWidth;
	brush_height_float = nextHeight;
	syncBrushSizeInputs();
}
let smoothing_factor = 0.5;
let follow_angle_rads = 0;

// Rotate
let rotate_on = false;
let manual_inc_rotate = 10;
let rotate_angle = 0;
let rotate_angle_rads = rotate_angle * (Math.PI / 180);
let rotate_speed = parseFloat(500 / 100);
let auto_rotate = true;
let origin_x = 0;
let origin_y = 0;
let flip_brush_h = false;
let flip_brush_v = false;

// let total_angle_rads = 0;

// Mirror
let mirror_on = false;
let mirror_reflections = 4;
let mirror_origin_x = 50;
let mirror_origin_y = 50;
let mirror_angle_degrees = 0;
let mirror_angle_rads = (mirror_angle_degrees * Math.PI) / 180; // Convert to radians;
let mirror_origin = getMirrorOrigin();

// Snap
let snap_on = false;
let snap_match_brush_size_on = false;
let snap_x = 10;
let snap_y = 10;
let is_x_holding_set = false;
let is_y_holding_set = false;
let is_x_holding = false;
let is_y_holding = false;
let x_hold = 0;
let y_hold = 0;

// Increment
let increment_on = false;
let auto_inc_x_amount = 2;
let auto_inc_y_amount = 2;
let auto_inc_x_running = 0;
let auto_inc_y_running = 0;
let increment_screen_wrap_on = true;
let wave_on = false;
let x_amp = 20;
let x_freq = 0.09;
let x_phase = 0;
let y_amp = 80;
let y_freq = 0.02;
let y_phase = 0;

// Fx
let fx_on = false;
let filters = "none"; // `sepia(100%)`; // `blur(5px)`;

function isFxAllowedForBrushType(_brush_type_name) {
	return true;
}

let hue_rotate_on = true;
let hue_rotate_amount = 0;
let auto_hue_rotate_on = true;
let auto_hue_increment_amount = 10;

let brightness_on = true;
let brightness_amount = 100;
let brightness_auto_increment_on = true;
let brightness_auto_increment_amount = 1.89;
let brightness_ping_pong_on = true;
let brightness_ping_pong_direction = 1;

let saturate_on = true;
let saturate_amount = 100;
let saturate_auto_increment_on = true;
let saturate_auto_increment_amount = 2.23;
let saturate_ping_pong_on = true;
let saturate_ping_pong_direction = 1;

let drop_shadow_on = false;
let drop_shadow_color = "black";
let drop_shadow_color_rgb = hexToRgba(drop_shadow_color);
let drop_shadow_x_amount = 30;
let drop_shadow_y_amount = 30;
let drop_shadow_blur_amount = 10;

let opacity_on = false;
let opacity_amount = 100;
let opacity_auto_increment_on = false;
let opacity_auto_increment_amount = 0.4;
let opacity_ping_pong_on = true;
let opacity_ping_pong_direction = 1;

let invert_on = true;
let invert_amount = 100;
let invert_auto_increment_on = false;
let invert_auto_increment_amount = 5;
let invert_ping_pong_on = false;
let invert_ping_pong_direction = 1;

let blur_on = false;
let blur_amount = 4;

// Blend
let blend_on = false;
let blend_mode = "difference";
const supported_blend_modes = new Set([
	"source-atop",
	"destination-over",
	"lighter",
	"copy",
	"xor",
	"multiply",
	"screen",
	"overlay",
	"darken",
	"lighten",
	"color-dodge",
	"color-burn",
	"hard-light",
	"soft-light",
	"difference",
	"exclusion",
	"hue",
	"saturation",
	"color",
	"luminosity",
]);

// Watercolor
let watercolor_on = false;
let watercolor_wetness = 0.45;
let watercolor_pigment = 0.18;
let watercolor_granulation = 0.3;
let watercolor_bleed = 6;
let watercolor_blendmode = "multiply";
let last_watercolor_deposit = null;
const watercolor_melt_canvas = document.createElement("canvas");
const watercolor_melt_ctx = watercolor_melt_canvas.getContext("2d");

function normalizeBlendMode(mode) {
	const aliases = {
		normal: "source-over",
		blend_xor: "xor",
		blend_hue: "hue",
	};
	const normalized_mode = String(mode).trim().toLowerCase();
	return aliases[normalized_mode] || normalized_mode;
}

function setBrushBlendMode(mode) {
	const next_mode = normalizeBlendMode(mode);
	if (!supported_blend_modes.has(next_mode)) {
		console.warn(`Unsupported blend mode: ${mode}`);
		return false;
	}

	blend_mode = next_mode;
	if (blend_on && typeof draw_ctx !== "undefined") {
		draw_ctx.globalCompositeOperation = blend_mode;
	}
	return true;
}

function setWatercolorBlendMode(mode) {
	const next_mode = normalizeBlendMode(mode);
	if (!supported_blend_modes.has(next_mode)) {
		console.warn(`Unsupported watercolor blend mode: ${mode}`);
		return false;
	}

	watercolor_blendmode = next_mode;
	return true;
}

function setBrushBlendEnabled(enabled) {
	blend_on = Boolean(enabled);
	if (typeof draw_ctx !== "undefined") {
		setBlendMode(draw_ctx);
	}
	if (typeof updateFxButtonStates === "function") {
		updateFxButtonStates();
	}
	return blend_on;
}

let tint_r = 255;
let tint_g = 255;
let tint_b = 255;

// Set sliders and inputs to initial settings
function setSlidersAndInputs() {
	// BRUSH SIZE
	syncBrushSizeInputs();

	// IMAGE
	const syncImageRadio = () => {
		const image_radio = document.getElementById(`image_brush_${image_index}`);
		if (image_radio) {
			image_radio.checked = true;
			return true;
		}
		return false;
	};
	if (!syncImageRadio()) {
		setTimeout(syncImageRadio, 0);
	}

	const image_opacity_input = document.getElementById("image_opacity_input_range");
	if (image_opacity_input) {
		image_opacity_input.value = image_opacity;
	}
}

setSlidersAndInputs();

//////////////////////////
//      RANDOMIZER      //
//////////////////////////

function randAll() {
	// Brush and image. Pick the image first because its aspect ratio determines
	// the largest brush that can fit completely within the canvas.
	brush_type = "image";
	if (image_array.length > 0) {
		image_index = getRandomInt(0, image_array.length - 1);
	}
	image_opacity = getRandomInt(20, 100);
	brush_size_increment_x = getRandomInt(1, 8);
	brush_size_increment_y = getRandomInt(1, 8);

	const aspect_ratio = Math.max(0.01, getActiveBrushAspectRatio());
	const max_brush_height = Math.max(1, Math.floor(Math.min(window_h, window_w / aspect_ratio)));
	const configured_brush_size_min = Math.max(1, Math.ceil(Math.min(brush_size_rand_min, brush_size_rand_max)));
	const configured_brush_size_max = Math.max(configured_brush_size_min, Math.floor(Math.max(brush_size_rand_min, brush_size_rand_max)));
	const rand_brush_size_max = Math.max(configured_brush_size_min, Math.min(configured_brush_size_max, max_brush_height));
	setBrushSizeFromHeight(getRandomInt(configured_brush_size_min, rand_brush_size_max));

	if (brush_size_automation_on) {
		brush_size_before_automation = {
			width: brush_width,
			height: brush_height,
			width_float: brush_width_float,
			height_float: brush_height_float,
		};
	}

	// Randomiser and drawing cadence.
	randomiser_brush_size_min = getRandomInt(1, Math.max(1, brush_height));
	randomiser_brush_size_max = getRandomInt(randomiser_brush_size_min, max_brush_height);
	// drawing_speed = getRandomInt(1, 8);

	// Size automation parameters. Keep every walker inside its matching canvas dimension.
	const width_room = Math.max(0, Math.floor(Math.min(brush_width - 1, window_w - brush_width)));
	const height_room = Math.max(0, Math.floor(Math.min(brush_height - 1, window_h - brush_height)));
	randomise_width_range = getRandomInt(0, width_room);
	randomise_height_range = getRandomInt(0, height_room);
	randomise_width_speed = getRandomFloat(0.5, 7, 2);
	randomise_height_speed = getRandomFloat(0.5, 7, 2);
	randomise_width_easing = getRandomFloat(0.15, 1, 2);
	randomise_height_easing = getRandomFloat(0.15, 1, 2);

	// Follow and rotation.
	smoothing_factor = getRandomFloat(0.1, 0.9, 2);
	manual_inc_rotate = getRandomInt(1, 45);
	rotate_speed = getRandomFloat(-8, 8, 2);

	// Mirror, snap, increment, and wave.
	mirror_reflections = [2, 3, 4, 5, 6, 7, 8][getRandomInt(0, 6)];
	mirror_origin_x = getRandomInt(0, 100);
	mirror_origin_y = getRandomInt(0, 100);
	mirror_angle_degrees = getRandomInt(0, 359);
	mirror_angle_rads = (mirror_angle_degrees * Math.PI) / 180;
	mirror_origin = getMirrorOrigin();

	// snap_x = getRandomInt(1, Math.max(1, Math.min(window_w, Math.round(brush_width))));
	// snap_y = getRandomInt(1, Math.max(1, Math.min(window_h, Math.round(brush_height))));

	auto_inc_x_amount = getRandomInt(-20, 20);
	auto_inc_y_amount = getRandomInt(-20, 20);
	auto_inc_x_running = 0;
	auto_inc_y_running = 0;
	x_amp = getRandomInt(0, Math.floor(window_w / 3));
	y_amp = getRandomInt(0, Math.floor(window_h / 3));
	x_freq = getRandomFloat(0.005, 0.15, 3);
	y_freq = getRandomFloat(0.005, 0.15, 3);
	x_phase = getRandomFloat(0, Math.PI * 2, 3);
	y_phase = getRandomFloat(0, Math.PI * 2, 3);

	// Per-stamp CSS effects.
	hue_rotate_amount = getRandomInt(0, 359);
	auto_hue_increment_amount = getRandomFloat(-15, 15, 2);
	brightness_amount = getRandomInt(40, 180);
	brightness_auto_increment_amount = getRandomFloat(0.1, 5, 2);
	brightness_ping_pong_direction = getRandomBoolean() ? 1 : -1;
	saturate_amount = getRandomInt(0, 250);
	saturate_auto_increment_amount = getRandomFloat(0.1, 6, 2);
	saturate_ping_pong_direction = getRandomBoolean() ? 1 : -1;
	opacity_amount = getRandomInt(20, 100);
	opacity_auto_increment_amount = getRandomFloat(0.1, 3, 2);
	opacity_ping_pong_direction = getRandomBoolean() ? 1 : -1;
	invert_amount = getRandomInt(0, 100);
	invert_auto_increment_amount = getRandomFloat(0.1, 5, 2);
	invert_ping_pong_direction = getRandomBoolean() ? 1 : -1;
	blur_amount = getRandomFloat(0, 12, 1);
	drop_shadow_color = getRandomHexColor();
	drop_shadow_color_rgb = hexToRgba(drop_shadow_color);
	drop_shadow_x_amount = getRandomInt(-30, 30);
	drop_shadow_y_amount = getRandomInt(-30, 30);
	drop_shadow_blur_amount = getRandomInt(0, 20);

	// Canvas filter parameters exposed by filters.js.
	window.posterize_levels_amount = getRandomInt(2, 4);
	window.dither_pixel_size = getRandomInt(1, 6);
	window.emboss_pixel_size_amount = getRandomInt(1, 4);
	window.edge_pixel_size_amount = getRandomInt(1, 4);
	window.pixelate_amount = getRandomInt(2, 4);
	window.glitch_pixel_size = getRandomInt(2, 20);
	window.glitch_amount = getRandomInt(2, 10);
	window.wave_amplitude = getRandomInt(1, 12);
	window.wave_frequency = getRandomInt(2, 10);

	// Blend and watercolor.
	const blend_modes = Array.from(supported_blend_modes).filter((mode) => mode !== "copy");
	blend_mode = blend_modes[getRandomInt(0, blend_modes.length - 1)];
	watercolor_wetness = getRandomFloat(0.1, 1, 2);
	watercolor_pigment = getRandomFloat(0.1, 1, 2);
	watercolor_granulation = getRandomFloat(0, 1, 2);
	watercolor_bleed = getRandomFloat(0, 12, 1);
	last_watercolor_deposit = null;

	// tint_r = getRandomInt(0, 255);
	// tint_g = getRandomInt(0, 255);
	// tint_b = getRandomInt(0, 255);

	initRandomWalkers();
	setFilters();
	setBlendMode(draw_ctx);
	updateFxButtonStates();

	setSlidersAndInputs();
	showFeedbackNotification("Rand()");
}

/////////////////////////////
//   CONTROLS MANAGEMENT   //
/////////////////////////////
// c d f g h n m p r s t w x y z 1-9 0
function stepBrushSize(direction) {
	brush_height_float += brush_size_increment_y * direction;
	setBrushSizeFromHeight(Math.round(brush_height_float));
}

function stepManualRotate(direction) {
	rotate_angle += manual_inc_rotate * direction;
	rotate_angle_rads = rotate_angle * (Math.PI / 180);
}

function shouldIgnoreKeyboardShortcut(event) {
	const activeElement = document.activeElement;
	const target = event.target;
	const editableElement = target instanceof Element ? target : activeElement;

	if (submission_dialog?.open && editableElement?.closest("#submission_dialog")) {
		return true;
	}

	if (!activeElement) {
		return false;
	}

	if (activeElement.closest?.("#nav_container")) {
		return false;
	}

	if (activeElement.isContentEditable) {
		return true;
	}

	const tagName = activeElement.tagName;
	return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
}

document.addEventListener("keydown", (e) => {
	// console.log("key: " + e.key);
	if (shouldIgnoreKeyboardShortcut(e)) {
		return;
	}

	// Skip if a meta key is held down
	if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;

	if (e.key == "s") {
		DownloadCanvasAsImage();
	} else if (e.key == "n") {
		stepBrushSize(-1);
	} else if (e.key == "m") {
		stepBrushSize(1);
	} else if (e.key === "d") {
		stepManualRotate(-1);
	} else if (e.key === "c") {
		stepManualRotate(1);
	} else if (e.key == "f") {
		is_x_holding = true;
		console.log("Holding x axis");
	} else if (e.key == "v") {
		is_y_holding = true;
		console.log("Holding y axis");
	} else if (e.key === "z" && draw_canvas) {
		layerUndo();
	} else if (e.key === "x" && draw_canvas) {
		layerRedo();
	} else if (e.key === "g") {
		flip_brush_h = true;
		console.log("Brush flipped horizontal");
	} else if (e.key === "b") {
		flip_brush_v = true;
		console.log("Brush flipped vertical");
	}
});

function toggleControlsVisibility() {
	document.querySelectorAll("#nav_container").forEach((bar) => {
		bar.classList.toggle("hidden");
	});
}

document.addEventListener("keyup", (e) => {
	if (shouldIgnoreKeyboardShortcut(e)) {
		return;
	}

	if (e.key == "f" || e.key == "v") {
		is_x_holding = false;
		is_x_holding_set = false;
		is_y_holding = false;
		is_y_holding_set = false;
	} else if (e.key === "g") {
		flip_brush_h = false;
	} else if (e.key === "b") {
		flip_brush_v = false;
	} else if (e.key === "h") {
		toggleControlsVisibility();
	} else if (e.key === "1") {
		setBrushSizeAutomation(!brush_size_automation_on);
		showEffectToggleNotification("Size", brush_size_automation_on);
		console.log(`brush_size_automation: ${brush_size_automation_on},
			randomise_lock_width_and_height: ${randomise_lock_width_and_height},
			randomise_width: ${randomise_width},
			random_walker_width: ${random_walker_width},
			randomise_width_range: ${randomise_width_range},
			randomise_width_speed: ${randomise_width_speed},
			randomise_width_easing: ${randomise_width_easing},
			randomise_height: ${randomise_height},
			random_walker_height: ${random_walker_height},
			randomise_height_range: ${randomise_height_range},
			randomise_height_speed: ${randomise_height_speed},
			randomise_height_easing: ${randomise_height_easing}`);
	} else if (e.key === "2") {
		follow_brush_direction = !follow_brush_direction;
		if (!follow_brush_direction) {
			if (rotate_on) {
				rotate_angle = getSavedRotateAngle();
				rotate_angle_rads = rotate_angle * (Math.PI / 180);
			} else {
				rotate_angle = 0;
				rotate_angle_rads = 0; // rotate_angle * (Math.PI / 180);
			}
		}
		showEffectToggleNotification("Follow", follow_brush_direction);
		console.log(`follow_brush_direction: ${follow_brush_direction}`);
	} else if (e.key === "3") {
		rotate_on = !rotate_on;
		if (rotate_on) {
			rotate_angle = getSavedRotateAngle();
			rotate_angle_rads = rotate_angle * (Math.PI / 180);
		} else {
			rotate_angle = 0;
			rotate_angle_rads = 0; // rotate_angle * (Math.PI / 180);
		}
		showEffectToggleNotification("Rotate", rotate_on);
		console.log(`rotate: ${rotate_on},
			rotate_angle: ${rotate_angle},
			rotate_speed: ${rotate_speed},
			auto_rotate: ${auto_rotate},
			origin_x: ${origin_x},
			origin_y: ${origin_y}`);
	} else if (e.key === "4") {
		mirror_on = !mirror_on;
		showEffectToggleNotification("Mirror", mirror_on);
		console.log(`mirror: ${mirror_on},
			mirror_reflections: ${mirror_reflections},
			mirror_angle_degrees: ${mirror_angle_degrees},
			mirror_origin_x: ${mirror_origin_x},
			mirror_origin_y: ${mirror_origin_y}`);
	} else if (e.key === "5") {
		snap_on = !snap_on;
		showEffectToggleNotification("Snap", snap_on);
		console.log(`snap: ${snap_on},
			snap_x: ${snap_x},
			snap_y: ${snap_y}`);
	} else if (e.key === "6") {
		increment_on = !increment_on;
		showEffectToggleNotification("Increment", increment_on);
		console.log(`increment: ${increment_on},
			auto_inc_x_amount: ${auto_inc_x_amount},
			auto_inc_y_amount: ${auto_inc_y_amount},
			increment_screen_wrap_on: ${increment_screen_wrap_on},
			wave_on: ${wave_on},
			x_amp: ${x_amp},
			x_freq: ${x_freq},
			y_amp: ${y_amp},
			y_freq: ${y_freq}`);
	} else if (e.key === "7") {
		fx_on = !fx_on;
		setFilters();
		showEffectToggleNotification("Fx", fx_on);
		console.log(`fx_on: ${fx_on},
			filters: ${filters},
			hue_rotate_on: ${hue_rotate_on},
			hue_rotate_amount: ${hue_rotate_amount},
			auto_hue_rotate_on: ${auto_hue_rotate_on},
			auto_hue_increment_amount: ${auto_hue_increment_amount},
			brightness_on: ${brightness_on},
			brightness_amount: ${brightness_amount},
			brightness_auto_increment_on: ${brightness_auto_increment_on},
			brightness_auto_increment_amount: ${brightness_auto_increment_amount},
			brightness_ping_pong_on: ${brightness_ping_pong_on},
			saturate_on: ${saturate_on},
			saturate_amount: ${saturate_amount},
			saturate_auto_increment_on: ${saturate_auto_increment_on},
			saturate_auto_increment_amount: ${saturate_auto_increment_amount},
			saturate_ping_pong_on: ${saturate_ping_pong_on},
			opacity_on: ${opacity_on},
			opacity_amount: ${opacity_amount},
			opacity_auto_increment_on: ${opacity_auto_increment_on},
			opacity_auto_increment_amount: ${opacity_auto_increment_amount},
			opacity_ping_pong_on: ${opacity_ping_pong_on},
			drop_shadow_color: ${drop_shadow_color},
			drop_shadow_x_amount: ${drop_shadow_x_amount},
			drop_shadow_y_amount: ${drop_shadow_y_amount},
			drop_shadow_blur_amount: ${drop_shadow_blur_amount},
			invert_on: ${invert_on},
			invert_amount: ${invert_amount},
			invert_auto_increment_on: ${invert_auto_increment_on},
			invert_auto_increment_amount: ${invert_auto_increment_amount},
			invert_ping_pong_on: ${invert_ping_pong_on},
			blur_on: ${blur_on},
			blur_amount: ${blur_amount}`);
	} else if (e.key === "8") {
		blend_on = !blend_on;
		showEffectToggleNotification("Blend", blend_on);
		console.log(`blend_on: ${blend_on},
			blend_mode: ${blend_mode},
			Available blend modes: source-atop, destination-over, destination-out, lighter, xor, multiply, screen, overlay, darken, lighten, color-dodge, color-burn, hard-light, soft-light, difference, exclusion, hue, saturation, color, luminosity`);
	} else if (e.key === "9") {
		watercolor_on = !watercolor_on;
		last_watercolor_deposit = null;
		showEffectToggleNotification("Watercolor", watercolor_on);
		console.log(`watercolor_on: ${watercolor_on},
			watercolor_wetness: ${watercolor_wetness},
			watercolor_pigment: ${watercolor_pigment},
			watercolor_granulation: ${watercolor_granulation},
			watercolor_bleed: ${watercolor_bleed},
			watercolor_blendmode: ${watercolor_blendmode}`);
	} else if (e.key === "0") {
		blend_on = false;
		fx_on = false;
		watercolor_on = false;
		last_watercolor_deposit = null;
		rotate_on = false;
		rotate_angle = 0;
		rotate_angle_rads = 0; // rotate_angle * (Math.PI / 180);
		mirror_on = false;
		snap_on = false;
		increment_on = false;
		follow_brush_direction = false;
		setBrushSizeAutomation(false);
		showFeedbackNotification("All effects off");
		console.log(`All behaviours turned off`);
	} else if (e.key === "a") {
		const brush_name_before_randomise = image_brush_array[Number.parseInt(image_index, 10)];
		randAll();
		const brush_name_after_randomise = image_brush_array[Number.parseInt(image_index, 10)];
		if (isDrawing && active_pointer_id !== null && brush_name_after_randomise !== brush_name_before_randomise) {
			recordCurrentBrushUsage();
		}
	} else if (e.key === "q") {
		blurr();
		showFeedbackNotification("Blur");
		console.log(`blur applied,
			canvas_blur_amount: ${window.canvas_blur_amount}`);
	} else if (e.key === "w") {
		invert();
		showFeedbackNotification("Invert");
		console.log(`invert applied,
			invert_percentage_amount: ${window.invert_percentage_amount}`);
	} else if (e.key === "e") {
		threshold();
		showFeedbackNotification("Threshold");
		console.log(`threshold applied,
			threshold_level_amount: ${window.threshold_level_amount}`);
	} else if (e.key === "r") {
		dither();
		showFeedbackNotification("Dither");
		console.log(`dither applied,
			dither_pixel_size: ${window.dither_pixel_size}`);
	} else if (e.key === "t") {
		dilate();
		showFeedbackNotification("Dilate");
		console.log(`dilate applied`);
	} else if (e.key === "y") {
		erode();
		showFeedbackNotification("Erode");
		console.log(`erode applied`);
	} else if (e.key === "u") {
		emboss();
		showFeedbackNotification("Emboss");
		console.log(`emboss applied,
			emboss_pixel_size_amount: ${window.emboss_pixel_size_amount}`);
	} else if (e.key === "i") {
		edges();
		showFeedbackNotification("Edges");
		console.log(`edges applied,
			edge_pixel_size_amount: ${window.edge_pixel_size_amount}`);
	} else if (e.key === "o") {
		glitch();
		showFeedbackNotification("Glitch");
		console.log(`glitch applied,
			glitch_pixel_size: ${window.glitch_pixel_size},
			glitch_amount: ${window.glitch_amount}`);
	} else if (e.key === "p") {
		pixelate();
		showFeedbackNotification("Pixelate");
		console.log(`pixelate applied,
			pixelate_amount: ${window.pixelate_amount}`);
	} else if (e.key === "j") {
		animatedGlitch();
		showEffectToggleNotification("Animated Glitch", window.animated_glitch_on);
		console.log(`animated glitch applied,
			animation_speed: ${window.animation_speed},
			glitch_pixel_size: ${window.glitch_pixel_size},
			glitch_amount: ${window.glitch_amount}`);
	} else if (e.key === "k") {
		animatedVhs();
		showEffectToggleNotification("Animated VHS", window.animated_vhs_on);
		console.log(`animated vhs applied,
			animation_speed: ${window.animation_speed}`);
	} else if (e.key === "l") {
		animatedDither();
		showEffectToggleNotification("Animated Dither", window.animated_dither_on);
		console.log(`animated dither applied,
			animation_speed: ${window.animation_speed},
			dither_pixel_size: ${window.dither_pixel_size}`);
	} else if (e.key === ";") {
		animatedWave();
		showEffectToggleNotification("Animated Wave", window.animated_wave_on);
		console.log(`animated wave applied,
			animation_speed: ${window.animation_speed},
			wave_amplitude: ${window.wave_amplitude},
			wave_frequency: ${window.wave_frequency}`);
	}
});

// Any change in inputs
document.addEventListener("input", function (event) {
	if (event.target && event.target.classList.contains("canvas_controller")) {
		let type = event.target.dataset.type;
		console.log(type);
	} else if (event.target && event.target.classList.contains("brush_controller")) {
		let type = event.target.dataset.type;

		if (type == "brush_type") {
			const next_brush_type = event.target.dataset.brush_type;
			if (!isBrushTypeAvailable(next_brush_type)) {
				syncBrushType();
				return;
			}

			brush_type = next_brush_type;
		} else if (type == "brush_dim") {
			setBrushSizeFromHeight(event.target.value);

			if (randomise_width) {
				brush_width_random = new RandomWalker(
					brush_width,
					brush_width - randomise_width_range,
					brush_width + randomise_width_range,
					randomise_width_speed,
					randomise_width_easing,
					random_walker_width,
				);
			}
			if (randomise_height) {
				brush_height_random = new RandomWalker(
					brush_height,
					brush_height - randomise_height_range,
					brush_height + randomise_height_range,
					randomise_height_speed,
					randomise_height_easing,
					random_walker_height,
				);
			}
		} else if (type == "image") {
			let controller = event.target.dataset.controller;
			if (controller == "image_is_ellipse") {
				image_is_ellipse = event.target.checked;
			} else if (controller == "image_brush_shape") {
				image_index = event.target.dataset.image_index;
				setBrushSizeFromHeight(getCurrentBrushSize());
			} else if (controller == "image_opacity") {
				image_opacity = clampPct(parseInt(event.target.value, 10) || 0);
			}
		}
	}
});

////////////////////////////
//     RANDOMISATION      //
////////////////////////////
function getRandomStep(speed, easing) {
	let step = (Math.random() * 2 - 1) * speed; // Random step scaled by speed
	return step * easing; // Apply easing
}

class RandomWalker {
	constructor(current_number, range_min, range_max, speed, easing, use_random_walker) {
		const min = Math.min(range_min, range_max);
		const max = Math.max(range_min, range_max);
		this.minRange = min;
		this.maxRange = max;
		this.currentNumber = current_number;
		this.speedFactor = speed; // Speed between 2-7
		this.easingFactor = easing; // Easing between 0.5-1
		this.useRandomWalker = use_random_walker; // Randomly enable walker mode
		// this.displayElement = this.createDisplayElement();
	}

	// Generate a random number within a range
	getRandomNumber(min, max) {
		if (min > max) {
			[min, max] = [max, min];
		}
		return Math.floor(Math.random() * (max - min + 1)) + min;
	}

	// Get a random step with speed and easing factors
	getRandomStep() {
		let step = (Math.random() * 2 - 1) * this.speedFactor;
		return step * this.easingFactor;
	}

	// Create a display element for each walker
	createDisplayElement() {
		let display = document.createElement("div");
		display.style.fontSize = "32px";
		display.style.fontWeight = "bold";
		display.style.textAlign = "center";
		display.style.margin = "10px";
		document.body.appendChild(display);
		return display;
	}

	// Update the random number for this walker
	update() {
		if (this.useRandomWalker) {
			this.currentNumber += this.getRandomStep();
			// Keep within range
			this.currentNumber = Math.max(this.minRange, Math.min(this.maxRange, this.currentNumber));
		} else {
			this.currentNumber = this.getRandomNumber(this.minRange, this.maxRange);
		}
		// this.displayElement.textContent = `Walker ${this.id}: ${Math.round(this.currentNumber)}`;
	}
}

function initRandomWalkers() {
	const current_width = brush_width;
	brush_width_random = new RandomWalker(
		current_width,
		Math.max(1, current_width - randomise_width_range),
		Math.min(window_w, current_width + randomise_width_range),
		randomise_width_speed,
		randomise_width_easing,
		random_walker_width,
	);

	const current_height = brush_height;
	brush_height_random = new RandomWalker(
		current_height,
		Math.max(1, current_height - randomise_height_range),
		Math.min(window_h, current_height + randomise_height_range),
		randomise_height_speed,
		randomise_height_easing,
		random_walker_height,
	);
}

initRandomWalkers();

///////////////////////
//    IMAGE BRUSH    //
///////////////////////
function drawImageStamp(ctx, px, py, reflectX = false, reflectY = false, rotation = 0, stamp_options = {}) {
	// Bail out early if brush size is invalid
	if (!brush_width || !brush_height) {
		return; // Skip drawing if either dimension is 0
	}

	// Normalize negative sizes
	const scale = Number.isFinite(stamp_options.scale) ? stamp_options.scale : 1;
	const width = Math.abs(brush_width) * scale;
	const height = Math.abs(brush_height) * scale;

	ctx.save();
	ctx.globalAlpha *= getImageBrushAlpha() * (Number.isFinite(stamp_options.alpha) ? stamp_options.alpha : 1);
	if (stamp_options.composite_operation) {
		ctx.globalCompositeOperation = stamp_options.composite_operation;
	}
	if (Number.isFinite(stamp_options.blur) && stamp_options.blur > 0) {
		const active_filter = ctx.filter && ctx.filter !== "none" ? `${ctx.filter} ` : "";
		ctx.filter = `${active_filter}blur(${stamp_options.blur}px)`;
	}

	// Translate, rotate, and scale as needed
	ctx.translate(px + (stamp_options.offset_x || 0), py + (stamp_options.offset_y || 0));
	ctx.rotate(rotation + (stamp_options.rotation_offset || 0));
	ctx.scale(
		(reflectX ? -1 : 1) * (flip_brush_h ? -1 : 1) * (brush_width < 0 ? -1 : 1),
		(reflectY ? -1 : 1) * (flip_brush_v ? -1 : 1) * (brush_height < 0 ? -1 : 1),
	);

	// Draw the image centered at the transformed origin
	ctx.drawImage(image_array[image_index], -width / 2, -height / 2, width, height);

	ctx.restore();
}

function softenCanvasUnderWatercolor(ctx, px, py) {
	if (ctx !== draw_ctx || watercolor_wetness <= 0 || watercolor_bleed <= 0) {
		return;
	}

	const brush_radius = Math.hypot(Math.abs(brush_width), Math.abs(brush_height)) / 2;
	const padding = watercolor_bleed * 3;
	const radius = Math.ceil(brush_radius + padding);
	const source_x = Math.max(0, Math.floor(px - radius));
	const source_y = Math.max(0, Math.floor(py - radius));
	const source_right = Math.min(ctx.canvas.width, Math.ceil(px + radius));
	const source_bottom = Math.min(ctx.canvas.height, Math.ceil(py + radius));
	const source_width = source_right - source_x;
	const source_height = source_bottom - source_y;

	if (source_width <= 0 || source_height <= 0) {
		return;
	}

	if (watercolor_melt_canvas.width !== source_width || watercolor_melt_canvas.height !== source_height) {
		watercolor_melt_canvas.width = source_width;
		watercolor_melt_canvas.height = source_height;
	}

	watercolor_melt_ctx.setTransform(1, 0, 0, 1, 0, 0);
	watercolor_melt_ctx.globalAlpha = 1;
	watercolor_melt_ctx.globalCompositeOperation = "source-over";
	watercolor_melt_ctx.filter = "none";
	watercolor_melt_ctx.clearRect(0, 0, source_width, source_height);
	watercolor_melt_ctx.drawImage(ctx.canvas, source_x, source_y, source_width, source_height, 0, 0, source_width, source_height);

	ctx.save();
	ctx.globalAlpha *= watercolor_wetness * 0.2;
	ctx.globalCompositeOperation = "source-over";
	ctx.filter = `blur(${watercolor_bleed}px)`;
	ctx.drawImage(watercolor_melt_canvas, source_x, source_y);
	ctx.restore();
}

function drawWatercolorToCanvas(ctx, px, py, reflectX = false, reflectY = false, rotation = 0) {
	softenCanvasUnderWatercolor(ctx, px, py);

	const granulation = clamp01(watercolor_granulation);
	const pigment = clamp01(watercolor_pigment);
	const wetness = clamp01(watercolor_wetness);
	const layer_count = Math.round(3 + granulation * 4);
	const spread = Math.max(1, Math.min(Math.abs(brush_width), Math.abs(brush_height)) * (0.025 + granulation * 0.08));
	const layer_alpha = (pigment * 1.5) / layer_count;
	const composite_operation = blend_on ? blend_mode : watercolor_blendmode;

	for (let layer = 0; layer < layer_count; layer++) {
		const angle = Math.random() * Math.PI * 2;
		const distance = spread * Math.sqrt(Math.random());
		const scale_variation = 1 + (Math.random() * 2 - 1) * granulation * 0.12;

		drawImageStamp(ctx, px, py, reflectX, reflectY, rotation, {
			alpha: layer_alpha * getRandomFloat(0.65, 1.2),
			blur: watercolor_bleed * getRandomFloat(0.12, 0.38) * wetness,
			composite_operation,
			offset_x: Math.cos(angle) * distance,
			offset_y: Math.sin(angle) * distance,
			rotation_offset: (Math.random() * 2 - 1) * granulation * 0.12,
			scale: scale_variation,
		});
	}

	// A lightly defined final impression suggests pigment collecting at a drying edge.
	drawImageStamp(ctx, px, py, reflectX, reflectY, rotation, {
		alpha: pigment * 0.32,
		blur: Math.max(0.25, watercolor_bleed * 0.06),
		composite_operation,
		offset_x: (Math.random() * 2 - 1) * spread * 0.25,
		offset_y: (Math.random() * 2 - 1) * spread * 0.25,
		scale: 0.98 + Math.random() * 0.04,
	});
}

function drawImageToCanvas(ctx, px, py, reflectX = false, reflectY = false, rotation = 0) {
	if (watercolor_on) {
		drawWatercolorToCanvas(ctx, px, py, reflectX, reflectY, rotation);
		return;
	}

	drawImageStamp(ctx, px, py, reflectX, reflectY, rotation);
}

// Generate image controllers
let image_brush_array = [
	"blob1",
	"blob2",
	"blob3",
	"blob4",
	"blob5",
	"blob6",
	"blob7",
	"blob8",
	"blob9",
	"blob10",
	"blob11",
	"blob12",
	"blob13",
	"blob14",
	"blob15",
	"eye1",
	"eye2",
	"blob16",
	"blob17",
	"pepe01",
	"pepe02",
	"pepe03",
	"pepe04",
	"pepe05",
	"pepe06",
	"pepe07",
	"pepe14",
	"pepe15",
	"pepe16",
	"pepe18",
	"pepe19",
	"turtle",
	"sanicpepe",
	"groyper1",
	"groyper2",
	"groyper3",
	"orbi1",
	"orbi2",
	"orbi4",
	"orbi6",
	"orbi5",
	"weds1",
	"weds2",
	"hand",
	"dough",
	"pixels39",
	"xcp",
	"b19",
	"gaudi",
	"green_up",
	"red_down",
	"heart02",
	"sun4",
	"ufo4",
	"cat1",
	"cat2",
	"yellingatcat",
	"cheems",
	"doge1",
	"swoledoge",
	"firedog",
	"chad1",
	"face2",
	"face3",
	"face4",
	"fist1",
	"gondola1",
	"gondola2",
	"knuckles3",
	"mememan1",
	"mememan2",
	"orang1",
	"rarestbook",
	"sanic1",
	"sanic2",
	"sminem1",
	"spoderman1",
	"spongebob1",
	"wifejak1",
	"wifejakpepe",
	"trad",
	"doomer",
	"wojak2",
	"wojak3",
	"wojak6",
	"wojak7",
	"npc2",
	"grug1",
	"grug2",
	"template01",
	"template02",
	"template03",
	"template04",
	"template05",
	"foil1",
	"foil2",
];

for (let i = 0; i < image_brush_array.length; i++) {
	let image_name = image_brush_array[i];

	// create html controllers
	let image_controller = `<input type="radio" name="brush_shape" id="image_brush_${i}" class="controller brush_controller hidden_radio" data-type="image" data-controller="image_brush_shape" data-image_index="${i}"/>
      <label for="image_brush_${i}" class="controller color_box" style="background-image: url('brushes/${image_name}.png'); background-position: center; background-repeat: no-repeat; background-size: cover;"></label>`;

	document.getElementById("image_brush_controls").insertAdjacentHTML("beforeend", image_controller);

	// add url to image array
	image_array[i] = new Image();
	image_array[i].onload = () => {
		if (Number.parseInt(image_index, 10) !== i) {
			return;
		}

		setBrushSizeFromHeight(getCurrentBrushSize());
	};
	image_array[i].src = `brushes/${image_name}.png`;
}

const palette_tabs = Array.from(document.querySelectorAll(".palette_tab"));

function activatePaletteTab(next_tab) {
	for (const tab of palette_tabs) {
		const is_active = tab === next_tab;
		const panel = document.getElementById(tab.getAttribute("aria-controls"));

		tab.classList.toggle("is-active", is_active);
		tab.setAttribute("aria-selected", String(is_active));
		tab.tabIndex = is_active ? 0 : -1;
		panel.hidden = !is_active;
	}
}

for (const tab of palette_tabs) {
	tab.addEventListener("click", () => activatePaletteTab(tab));
	tab.addEventListener("keydown", (event) => {
		if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
			return;
		}

		event.preventDefault();
		const direction = event.key === "ArrowRight" ? 1 : -1;
		const next_index = (palette_tabs.indexOf(tab) + direction + palette_tabs.length) % palette_tabs.length;
		activatePaletteTab(palette_tabs[next_index]);
		palette_tabs[next_index].focus();
	});
}

const fx_toggle_buttons = Array.from(document.querySelectorAll(".fx_toggle"));

function getFxToggleState(effect_name) {
	const states = {
		size: brush_size_automation_on,
		follow: follow_brush_direction,
		rotate: rotate_on,
		mirror: mirror_on,
		snap: snap_on,
		increment: increment_on,
		fx: fx_on,
		blend: blend_on,
		watercolor: watercolor_on,
	};

	return states[effect_name];
}

function updateFxButtonStates() {
	for (const button of fx_toggle_buttons) {
		button.setAttribute("aria-pressed", String(getFxToggleState(button.dataset.fxToggle)));
	}
}

function toggleFxEffect(effect_name) {
	if (effect_name === "size") {
		setBrushSizeAutomation(!brush_size_automation_on);
	} else if (effect_name === "follow") {
		follow_brush_direction = !follow_brush_direction;
		if (!follow_brush_direction) {
			lastPos = null;
			smoothedDirection = { x: 1, y: 0 };
		}
	} else if (effect_name === "rotate") {
		rotate_on = !rotate_on;
		if (!rotate_on) {
			rotate_angle = 0;
			rotate_angle_rads = 0;
		}
	} else if (effect_name === "mirror") {
		mirror_on = !mirror_on;
	} else if (effect_name === "snap") {
		snap_on = !snap_on;
	} else if (effect_name === "increment") {
		increment_on = !increment_on;
	} else if (effect_name === "fx") {
		fx_on = !fx_on;
		setFilters();
	} else if (effect_name === "blend") {
		setBrushBlendEnabled(!blend_on);
	} else if (effect_name === "watercolor") {
		watercolor_on = !watercolor_on;
		last_watercolor_deposit = null;
	}

	updateFxButtonStates();
}

for (const button of fx_toggle_buttons) {
	button.addEventListener("click", () => toggleFxEffect(button.dataset.fxToggle));
}

const filter_buttons = Array.from(document.querySelectorAll(".filter_button"));
const animated_filter_states = {
	animatedGlitch: "animated_glitch_on",
	animatedVhs: "animated_vhs_on",
	animatedDither: "animated_dither_on",
	animatedWave: "animated_wave_on",
};
const animated_filter_names = {
	animatedGlitch: "Animated Glitch",
	animatedVhs: "Animated VHS",
	animatedDither: "Animated Dither",
	animatedWave: "Animated Wave",
};

function updateAnimatedFilterButtonStates() {
	for (const button of filter_buttons) {
		const state_name = animated_filter_states[button.dataset.filterAction];
		if (state_name) {
			button.setAttribute("aria-pressed", String(Boolean(window[state_name])));
		}
	}
}

for (const button of filter_buttons) {
	button.addEventListener("click", () => {
		const filter_action = window[button.dataset.filterAction];
		if (typeof filter_action === "function") {
			filter_action();
			updateAnimatedFilterButtonStates();
			const state_name = animated_filter_states[button.dataset.filterAction];
			if (state_name) {
				showEffectToggleNotification(animated_filter_names[button.dataset.filterAction], window[state_name]);
			}
		}
	});
}

// Keep button indicators in sync when the existing keyboard shortcuts change effects and animations.
document.addEventListener("keyup", () => {
	updateFxButtonStates();
	updateAnimatedFilterButtonStates();
});
updateFxButtonStates();
updateAnimatedFilterButtonStates();

////////////////////////
//     CANVASSES      //
////////////////////////
const draw_canvas = document.getElementById("draw_canvas");
const draw_ctx = draw_canvas.getContext("2d", { willReadFrequently: true });
const preview_canvas = document.getElementById("preview_canvas");
const preview_ctx = preview_canvas.getContext("2d");

const draw_canvas_data = {
	element: draw_canvas,
	context: draw_ctx,
	history: [],
	redoStack: [],
	blendMode: "normal",
	opacity: 1,
};

setupMainCanvas(draw_canvas, draw_ctx);
setupMainCanvas(preview_canvas, preview_ctx);
draw_canvas.style.zIndex = "1";
draw_canvas.style.mixBlendMode = draw_canvas_data.blendMode;
draw_canvas.style.opacity = draw_canvas_data.opacity;
preview_ctx.lineJoin = "miter";
preview_ctx.lineCap = "butt";

let brush_usage = Object.create(null);

function cloneBrushUsage(source = brush_usage) {
	const clone = Object.create(null);
	if (!source || typeof source !== "object" || Array.isArray(source)) {
		return clone;
	}

	for (const [brush_name, stroke_count] of Object.entries(source)) {
		if (brush_name.length > 0 && Number.isSafeInteger(stroke_count) && stroke_count > 0) {
			clone[brush_name] = stroke_count;
		}
	}
	return clone;
}

function restoreBrushUsage(source) {
	brush_usage = cloneBrushUsage(source);
}

function recordCurrentBrushUsage() {
	const brush_name = image_brush_array[Number.parseInt(image_index, 10)];
	if (typeof brush_name !== "string" || brush_name.length === 0) {
		return;
	}

	brush_usage[brush_name] = (brush_usage[brush_name] || 0) + 1;
}

function createCanvasHistoryState() {
	return {
		canvas_data_url: draw_canvas.toDataURL(),
		brush_usage: cloneBrushUsage(),
	};
}

function normalizeCanvasHistoryState(state) {
	if (typeof state === "string") {
		return {
			canvas_data_url: state,
			brush_usage: cloneBrushUsage(),
		};
	}

	return {
		canvas_data_url: state.canvas_data_url,
		brush_usage: cloneBrushUsage(state.brush_usage),
	};
}

function saveCanvasState() {
	const canvasHistory = draw_canvas_data.history;
	canvasHistory.push(createCanvasHistoryState());
	if (canvasHistory.length > 50) canvasHistory.shift();
	draw_canvas_data.redoStack = [];
}

const canvas_storage_database_name = "pepepaint";
const canvas_storage_database_version = 1;
const canvas_storage_store_name = "canvas_saves";
const canvas_storage_record_id = "latest";
let canvas_storage_database_promise = null;
let persistent_canvas_save_requested = false;
let persistent_canvas_save_task = null;
let canvas_storage_warning_shown = false;
let canvas_is_ready = false;
let number_of_strokes = 0;
let artwork_started_at = null;
let pointer_distance_travelled = 0;

function warnCanvasStorage(message, error) {
	if (canvas_storage_warning_shown) {
		return;
	}

	canvas_storage_warning_shown = true;
	console.warn(message, error);
}

function openCanvasStorageDatabase() {
	if (!("indexedDB" in window)) {
		return Promise.reject(new Error("IndexedDB is not available."));
	}

	if (!canvas_storage_database_promise) {
		canvas_storage_database_promise = new Promise((resolve, reject) => {
			const request = indexedDB.open(canvas_storage_database_name, canvas_storage_database_version);

			request.onupgradeneeded = () => {
				const database = request.result;
				if (!database.objectStoreNames.contains(canvas_storage_store_name)) {
					database.createObjectStore(canvas_storage_store_name, { keyPath: "id" });
				}
			};

			request.onsuccess = () => {
				const database = request.result;
				database.onversionchange = () => database.close();
				resolve(database);
			};

			request.onerror = () => reject(request.error || new Error("Could not open canvas storage."));
			request.onblocked = () => reject(new Error("Canvas storage upgrade was blocked by another tab."));
		}).catch((error) => {
			canvas_storage_database_promise = null;
			throw error;
		});
	}

	return canvas_storage_database_promise;
}

async function getLatestStoredCanvas() {
	const database = await openCanvasStorageDatabase();

	return new Promise((resolve, reject) => {
		const transaction = database.transaction(canvas_storage_store_name, "readonly");
		const request = transaction.objectStore(canvas_storage_store_name).get(canvas_storage_record_id);

		request.onsuccess = () => resolve(request.result || null);
		request.onerror = () => reject(request.error || new Error("Could not read the saved canvas."));
	});
}

async function putLatestStoredCanvas(blob, saved_traits) {
	const database = await openCanvasStorageDatabase();

	return new Promise((resolve, reject) => {
		const transaction = database.transaction(canvas_storage_store_name, "readwrite");
		transaction.objectStore(canvas_storage_store_name).put({
			id: canvas_storage_record_id,
			blob,
			width: draw_canvas.width,
			height: draw_canvas.height,
			number_of_strokes: saved_traits.number_of_strokes,
			artwork_started_at: saved_traits.artwork_started_at,
			pointer_distance_travelled: saved_traits.pointer_distance_travelled,
			brush_usage: cloneBrushUsage(saved_traits.brush_usage),
			updated_at: Date.now(),
			schema_version: 1,
		});

		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error || new Error("Could not save the canvas."));
		transaction.onabort = () => reject(transaction.error || new Error("Canvas storage was aborted."));
	});
}

async function deleteLatestStoredCanvas() {
	const database = await openCanvasStorageDatabase();

	return new Promise((resolve, reject) => {
		const transaction = database.transaction(canvas_storage_store_name, "readwrite");
		transaction.objectStore(canvas_storage_store_name).delete(canvas_storage_record_id);

		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error || new Error("Could not clear the saved canvas."));
		transaction.onabort = () => reject(transaction.error || new Error("Clearing canvas storage was aborted."));
	});
}

function createCanvasSnapshot() {
	const snapshot_canvas = document.createElement("canvas");
	snapshot_canvas.width = draw_canvas.width;
	snapshot_canvas.height = draw_canvas.height;
	snapshot_canvas.getContext("2d").drawImage(draw_canvas, 0, 0);
	return snapshot_canvas;
}

function canvasToPngBlob(canvas) {
	return new Promise((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (blob) {
				resolve(blob);
			} else {
				reject(new Error("Could not encode the canvas as PNG."));
			}
		}, "image/png");
	});
}

async function flushPersistentCanvasSaves() {
	while (persistent_canvas_save_requested) {
		persistent_canvas_save_requested = false;
		const snapshot_canvas = createCanvasSnapshot();
		const snapshot_traits = {
			number_of_strokes,
			artwork_started_at,
			pointer_distance_travelled,
			brush_usage: cloneBrushUsage(),
		};
		const blob = await canvasToPngBlob(snapshot_canvas);

		// A newer action finished while this PNG was being encoded. Skip the
		// stale write and immediately capture the latest canvas instead.
		if (persistent_canvas_save_requested) {
			continue;
		}

		await putLatestStoredCanvas(blob, snapshot_traits);
	}
}

function queuePersistentCanvasSave() {
	if (!canvas_is_ready) {
		return persistent_canvas_save_task || Promise.resolve();
	}

	if (window.pepepaint?.canvas_animation_on) {
		return persistent_canvas_save_task || Promise.resolve();
	}

	persistent_canvas_save_requested = true;

	if (!persistent_canvas_save_task) {
		persistent_canvas_save_task = flushPersistentCanvasSaves()
			.catch((error) => {
				warnCanvasStorage("PEPEPAINT could not save the latest canvas locally.", error);
			})
			.finally(() => {
				persistent_canvas_save_task = null;
				if (persistent_canvas_save_requested) {
					queuePersistentCanvasSave();
				}
			});
	}

	return persistent_canvas_save_task;
}

async function waitForPersistentCanvasSaves() {
	while (persistent_canvas_save_task) {
		await persistent_canvas_save_task;
	}
}

async function drawStoredCanvas(record) {
	if (!record || record.schema_version !== 1 || !(record.blob instanceof Blob)) {
		return false;
	}

	let image_source;
	let object_url = null;

	if ("createImageBitmap" in window) {
		image_source = await createImageBitmap(record.blob);
	} else {
		object_url = URL.createObjectURL(record.blob);
		image_source = await new Promise((resolve, reject) => {
			const image = new Image();
			image.onload = () => resolve(image);
			image.onerror = () => {
				URL.revokeObjectURL(object_url);
				object_url = null;
				reject(new Error("Could not decode the saved canvas."));
			};
			image.src = object_url;
		});
	}

	try {
		draw_ctx.clearRect(0, 0, draw_canvas.width, draw_canvas.height);
		draw_ctx.drawImage(image_source, 0, 0, draw_canvas.width, draw_canvas.height);
		number_of_strokes = Number.isSafeInteger(record.number_of_strokes) && record.number_of_strokes >= 0 ? record.number_of_strokes : 0;
		artwork_started_at = Number.isFinite(record.artwork_started_at) && record.artwork_started_at >= 0 ? record.artwork_started_at : null;
		pointer_distance_travelled =
			Number.isFinite(record.pointer_distance_travelled) && record.pointer_distance_travelled >= 0 ? record.pointer_distance_travelled : 0;
		restoreBrushUsage(record.brush_usage);
	} finally {
		image_source.close?.();
		if (object_url) {
			URL.revokeObjectURL(object_url);
		}
	}

	return true;
}

const canvas_blend_radios = document.getElementsByName("canvas_blend_mode");
function setRadios(blend_name) {
	canvas_blend_radios.forEach((radio) => {
		if (radio.value === blend_name) {
			radio.checked = true;
		}
	});
}

function setCanvasBlendMode(blendMode) {
	draw_canvas_data.blendMode = blendMode;
	draw_canvas.style.mixBlendMode = blendMode;
	setRadios(blendMode);
}

function layerUndo() {
	if (!canvas_is_ready) {
		return;
	}

	clearFilters();
	clearBlendMode(draw_ctx);

	const history = draw_canvas_data.history;
	if (history.length > 0) {
		const redoStack = draw_canvas_data.redoStack;
		redoStack.push(createCanvasHistoryState());
		const previousState = normalizeCanvasHistoryState(history.pop());

		const img = new Image();
		img.onload = () => {
			draw_ctx.clearRect(0, 0, window_w, window_h);
			draw_ctx.imageSmoothingEnabled = true;
			draw_ctx.drawImage(img, 0, 0, window_w, window_h);
			restoreBrushUsage(previousState.brush_usage);
			setFilters();
			setBlendMode(draw_ctx);
			queuePersistentCanvasSave();
		};
		img.src = previousState.canvas_data_url;
	} else {
		setFilters();
		setBlendMode(draw_ctx);
	}
}

function layerRedo() {
	if (!canvas_is_ready) {
		return;
	}

	clearFilters();
	clearBlendMode(draw_ctx);

	const redoStack = draw_canvas_data.redoStack;
	if (redoStack.length > 0) {
		const history = draw_canvas_data.history;
		history.push(createCanvasHistoryState());
		if (history.length > 50) history.shift();
		const nextState = normalizeCanvasHistoryState(redoStack.pop());

		const img = new Image();
		img.onload = () => {
			draw_ctx.clearRect(0, 0, window_w, window_h);
			draw_ctx.imageSmoothingEnabled = true;
			draw_ctx.drawImage(img, 0, 0, window_w, window_h);
			restoreBrushUsage(nextState.brush_usage);
			setFilters();
			setBlendMode(draw_ctx);
			queuePersistentCanvasSave();
		};
		img.src = nextState.canvas_data_url;
	} else {
		setFilters();
		setBlendMode(draw_ctx);
	}
}

setRadios(draw_canvas_data.blendMode);
function setFilters() {
	if (fx_on) {
		clearFilters();

		if (hue_rotate_on) {
			filters += `hue-rotate(${hue_rotate_amount}deg)`;
		}
		if (blur_on) {
			filters += `blur(${blur_amount}px)`;
		}
		if (brightness_on) {
			filters += `brightness(${brightness_amount}%)`;
		}
		if (opacity_on) {
			filters += `opacity(${parseInt(opacity_amount)}%)`;
		}
		if (invert_on) {
			filters += `invert(${invert_amount}%)`;
		}
		if (saturate_on) {
			filters += `saturate(${saturate_amount}%)`;
		}
		if (drop_shadow_on) {
			filters += `drop-shadow(${drop_shadow_x_amount}px ${drop_shadow_y_amount}px ${drop_shadow_blur_amount}px ${drop_shadow_color})`;
		}
	} else {
		// draw_ctx.filter = 'none';
		// preview_ctx.filter = 'none';
		clearFilters();
	}
	draw_ctx.filter = filters;
}

function clearFilters() {
	filters = ``;
	draw_ctx.filter = "none";
	preview_ctx.filter = "none";
}

function setBlendMode(ctx) {
	if (blend_on) {
		ctx.globalCompositeOperation = blend_mode;
	} else {
		ctx.globalCompositeOperation = "source-over";
	}
}

function clearBlendMode(ctx) {
	draw_ctx.globalCompositeOperation = "source-over";
}

/////////////////////////
//        DRAW         //
/////////////////////////
function getPointerPosition(canvas, event) {
	// Function to get the pointer position relative to the canvas
	const rect = canvas.getBoundingClientRect(); // Get the canvas bounds
	const x = event.clientX - rect.left; // Adjust for canvas position
	const y = event.clientY - rect.top;
	return { x, y };
}

function doBrushing(ctx, px, py) {
	drawImageToCanvas(ctx, px, py, false, false, rotate_angle_rads);
	if (!mirror_on) {
		return;
	}

	if (mirror_reflections % 2 === 1) {
		for (let i = 1; i < mirror_reflections; i++) {
			const theta = mirror_angle_rads + i * ((2 * Math.PI) / mirror_reflections);
			const p = rotatePoint(px, py, mirror_origin, theta);
			drawImageToCanvas(ctx, p.x, p.y, 50, 50, rotate_angle_rads);
		}
		return;
	}

	if (mirror_reflections == 2) {
		const rp = reflectPoint(px, py, mirror_angle_rads);
		drawImageToCanvas(ctx, rp.x, rp.y, false, true, -rotate_angle_rads);
	} else if (mirror_reflections == 4) {
		const rp1 = reflectPoint(px, py, mirror_angle_rads);
		drawImageToCanvas(ctx, rp1.x, rp1.y, false, true, -rotate_angle_rads);

		const rp2 = reflectPoint(px, py, mirror_angle_rads + Math.PI / 2);
		drawImageToCanvas(ctx, rp2.x, rp2.y, true, false, -rotate_angle_rads);

		const rp3 = rotatePoint(px, py, mirror_origin, Math.PI);
		drawImageToCanvas(ctx, rp3.x, rp3.y, true, true, rotate_angle_rads);
	} else if (mirror_reflections == 6) {
		const p1 = rotatePoint(px, py, mirror_origin, (2 * Math.PI) / 3);
		drawImageToCanvas(ctx, p1.x, p1.y, true, false, rotate_angle_rads);

		const p2 = rotatePoint(px, py, mirror_origin, (4 * Math.PI) / 3);
		drawImageToCanvas(ctx, p2.x, p2.y, false, true, rotate_angle_rads);

		const pr = reflectPoint(px, py, mirror_angle_rads);
		drawImageToCanvas(ctx, pr.x, pr.y, false, true, -rotate_angle_rads);

		const pr1 = rotatePoint(pr.x, pr.y, mirror_origin, (2 * Math.PI) / 3);
		drawImageToCanvas(ctx, pr1.x, pr1.y, true, false, -rotate_angle_rads);

		const pr2 = rotatePoint(pr.x, pr.y, mirror_origin, (4 * Math.PI) / 3);
		drawImageToCanvas(ctx, pr2.x, pr2.y, true, true, -rotate_angle_rads);
	} else if (mirror_reflections === 8) {
		const p1 = rotatePoint(px, py, mirror_origin, Math.PI / 2);
		drawImageToCanvas(ctx, p1.x, p1.y, true, false, rotate_angle_rads);

		const p2 = rotatePoint(px, py, mirror_origin, Math.PI);
		drawImageToCanvas(ctx, p2.x, p2.y, true, true, rotate_angle_rads);

		const p3 = rotatePoint(px, py, mirror_origin, (3 * Math.PI) / 2);
		drawImageToCanvas(ctx, p3.x, p3.y, false, true, rotate_angle_rads);

		const pr = reflectPoint(px, py, mirror_angle_rads);
		drawImageToCanvas(ctx, pr.x, pr.y, true, true, -rotate_angle_rads);

		const pr1 = rotatePoint(pr.x, pr.y, mirror_origin, Math.PI / 2);
		drawImageToCanvas(ctx, pr1.x, pr1.y, true, false, -rotate_angle_rads);

		const pr2 = rotatePoint(pr.x, pr.y, mirror_origin, Math.PI);
		drawImageToCanvas(ctx, pr2.x, pr2.y, false, false, -rotate_angle_rads);

		const pr3 = rotatePoint(pr.x, pr.y, mirror_origin, (3 * Math.PI) / 2);
		drawImageToCanvas(ctx, pr3.x, pr3.y, false, true, -rotate_angle_rads);
	}
}

function shouldDepositWatercolor(px, py, timestamp) {
	if (!watercolor_on) {
		return true;
	}

	if (!last_watercolor_deposit) {
		last_watercolor_deposit = { x: px, y: py, timestamp };
		return true;
	}

	const distance = Math.hypot(px - last_watercolor_deposit.x, py - last_watercolor_deposit.y);
	const movement_threshold = Math.max(2, Math.min(12, Math.min(Math.abs(brush_width), Math.abs(brush_height)) * 0.08));
	const pooling_interval = 260 - clamp01(watercolor_wetness) * 120;

	if (distance < movement_threshold && timestamp - last_watercolor_deposit.timestamp < pooling_interval) {
		return false;
	}

	last_watercolor_deposit = { x: px, y: py, timestamp };
	return true;
}

function mouseIsDown() {
	px = mousePos.x;
	py = mousePos.y;

	if (isDrawing) {
		drawing_frame_count++;

		if (drawing_frame_count % drawing_speed === 0) {
			// for holding an axis
			if (is_x_holding) {
				if (!is_x_holding_set) {
					x_hold = mousePos.x;
					is_x_holding_set = true;
				}
				px = x_hold;
			}
			if (is_y_holding) {
				if (!is_y_holding_set) {
					y_hold = mousePos.y;
					is_y_holding_set = true;
				}
				py = y_hold;
			}

			// Size randomisation
			if (brush_size_automation_on) {
				if (randomise_width) {
					brush_width_random.update();
					brush_width = brush_width_random.currentNumber;
					if (randomise_lock_width_and_height) {
						brush_height = brush_width;
					}
				}
				if (randomise_height && !randomise_lock_width_and_height) {
					brush_height_random.update();
					brush_height = brush_height_random.currentNumber;
				}
			}

			// Snapping
			if (snap_on) {
				px = Math.round(px / snap_x) * snap_x;
				py = Math.round(py / snap_y) * snap_y;
			}

			// Incrementing
			if (increment_on) {
				auto_inc_x_running = auto_inc_x_running + auto_inc_x_amount;
				auto_inc_y_running = auto_inc_y_running + auto_inc_y_amount;

				if (increment_screen_wrap_on) {
					px = (((px + auto_inc_x_running) % window_w) + window_w) % window_w;
					py = (((py + auto_inc_y_running) % window_h) + window_h) % window_h;
				} else {
					px = px + auto_inc_x_running;
					py = py + auto_inc_y_running;
				}

				if (wave_on) {
					let sin_y = y_amp * Math.sin(y_freq * px) + y_phase;
					let sin_x = x_amp * Math.sin(x_freq * py) + x_phase;
					py = py + sin_y;
					px = px + sin_x;
				}
			}

			// rotate_angle while the mouse is down
			if (follow_brush_direction) {
				if (rotate_on && auto_rotate) {
					rotate_angle += rotate_speed;
					rotate_angle_rads = rotate_angle * (Math.PI / 180);
					rotate_angle_rads += follow_angle_rads;
				} else {
					rotate_angle_rads = follow_angle_rads;
				}
			} else {
				if (rotate_on && auto_rotate) {
					rotate_angle += rotate_speed;
					rotate_angle_rads = rotate_angle * (Math.PI / 180);
					rotate_angle_rads += follow_angle_rads;
				}
			}

			// add/increment filters
			if (fx_on) {
				if (auto_hue_rotate_on) {
					hue_rotate_amount += auto_hue_increment_amount;
				}
				if (brightness_auto_increment_on) {
					if (brightness_ping_pong_on) {
						brightness_amount += brightness_auto_increment_amount * brightness_ping_pong_direction;

						// Reverse direction if hitting the bounds
						if (brightness_amount >= 200 || brightness_amount <= 0) {
							brightness_ping_pong_direction *= -1;
							// Ensure the value stays within bounds
							brightness_amount = Math.max(0, Math.min(200, brightness_amount));
						}
					} else {
						brightness_amount = (brightness_amount + brightness_auto_increment_amount) % 200;
					}
				}
				if (saturate_auto_increment_on) {
					if (saturate_ping_pong_on) {
						saturate_amount += saturate_auto_increment_amount * saturate_ping_pong_direction;

						// Reverse direction if hitting the bounds
						if (saturate_amount >= 200 || saturate_amount <= 0) {
							saturate_ping_pong_direction *= -1;
							// Ensure the value stays within bounds
							saturate_amount = Math.max(0, Math.min(200, saturate_amount));
						}
					} else {
						saturate_amount = (saturate_amount + saturate_auto_increment_amount) % 200;
					}
				}
				if (opacity_auto_increment_on) {
					if (opacity_ping_pong_on) {
						opacity_amount += opacity_auto_increment_amount * opacity_ping_pong_direction;

						// Reverse direction if hitting the bounds
						if (opacity_amount >= 100 || opacity_amount <= 0) {
							opacity_ping_pong_direction *= -1;
							// Ensure the value stays within bounds
							opacity_amount = Math.max(0, Math.min(100, opacity_amount));
						}
					} else {
						opacity_amount = (opacity_amount + opacity_auto_increment_amount) % 100;
					}
				}
				if (invert_auto_increment_on) {
					if (invert_ping_pong_on) {
						invert_amount += invert_auto_increment_amount * invert_ping_pong_direction;

						// Reverse direction if hitting the bounds
						if (invert_amount >= 100 || invert_amount <= 0) {
							invert_ping_pong_direction *= -1;
							// Ensure the value stays within bounds
							invert_amount = Math.max(0, Math.min(100, invert_amount));
						}
					} else {
						invert_amount = (invert_amount + invert_auto_increment_amount) % 100;
					}
				}
				setFilters();
			}

			if (mirror_on) {
				mirror_origin = getMirrorOrigin();
			}

			if (shouldDepositWatercolor(px, py, performance.now())) {
				doBrushing(draw_ctx, px, py);
			}
		}

		// Call this function again on the next animation frame
		if (constantlyUpdateOnMousedown) {
			requestAnimationFrame(mouseIsDown);
		}
	}
}

// POINTER EVENTS
let active_pointer_id = null;
let distance_last_pointer_position = null;

function addPointerDistance(position) {
	if (!distance_last_pointer_position) {
		distance_last_pointer_position = { x: position.x, y: position.y };
		return;
	}

	pointer_distance_travelled += Math.hypot(position.x - distance_last_pointer_position.x, position.y - distance_last_pointer_position.y);
	distance_last_pointer_position = { x: position.x, y: position.y };
}

preview_canvas.addEventListener("pointerdown", (event) => {
	// Event listener for pointer down (start drawing on draw_canvas)
	if (!canvas_is_ready) {
		return;
	}
	if (window.pepepaint.canvas_animation_on) {
		return;
	}
	if (active_pointer_id !== null && active_pointer_id !== event.pointerId) {
		return;
	}
	if (event.pointerType === "mouse" && event.button !== 0) {
		return;
	}

	if (event.pointerType !== "mouse") {
		event.preventDefault();
	}

	active_pointer_id = event.pointerId;
	preview_canvas.setPointerCapture(event.pointerId);
	mousePos = getPointerPosition(preview_canvas, event);
	distance_last_pointer_position = { x: mousePos.x, y: mousePos.y };
	last_watercolor_deposit = null;

	saveCanvasState();
	recordCurrentBrushUsage();
	if (artwork_started_at === null) {
		artwork_started_at = Date.now();
	}
	number_of_strokes += 1;

	// setFilters(); // do this on mouseIsDown for automation
	setBlendMode(draw_ctx);

	if (is_x_holding) {
		x_hold = mousePos.x;
		is_x_holding_set = true;
	}
	if (is_y_holding) {
		y_hold = mousePos.y;
		is_y_holding_set = true;
	}
	isDrawing = true; // Set drawing mode to true
	preview_ctx.clearRect(0, 0, window_w, window_h); // Clear the top canvas before redrawing (avoids smearing of previous drawings)

	mouseIsDown();
});

preview_canvas.addEventListener("pointerup", (event) => {
	// Event listener for pointer up (stop drawing)
	if (event.pointerId !== active_pointer_id) {
		return;
	}
	mousePos = getPointerPosition(preview_canvas, event);
	addPointerDistance(mousePos);
	distance_last_pointer_position = null;

	isDrawing = false; // Set drawing mode to false
	auto_inc_x_running = 0;
	auto_inc_y_running = 0;
	last_watercolor_deposit = null;

	clearFilters();
	clearBlendMode(draw_ctx);
	queuePersistentCanvasSave();

	preview_canvas.releasePointerCapture(event.pointerId);
	active_pointer_id = null;
});

preview_canvas.addEventListener("pointerout", (event) => {
	// Optional: Pointer out event to stop drawing if pointer leaves canvas
	const is_mouse_pointer = event.pointerType === "mouse";
	if (!is_mouse_pointer && event.pointerId !== active_pointer_id) {
		return;
	}

	if (stop_drawing_on_mouse_out) {
		const action_was_active = isDrawing;
		if (action_was_active && event.pointerId === active_pointer_id) {
			addPointerDistance(getPointerPosition(preview_canvas, event));
		}
		distance_last_pointer_position = null;
		isDrawing = false;
		auto_inc_x_running = 0;
		auto_inc_y_running = 0;
		last_watercolor_deposit = null;
		lastPos = null; // Reset last position to avoid drawing a line on re-entry
		if (action_was_active) {
			queuePersistentCanvasSave();
		}
	}
	if (is_mouse_pointer) {
		lastPos = null;
	}

	preview_ctx.clearRect(0, 0, window_w, window_h); // clear any preview
});

preview_canvas.addEventListener("pointercancel", (event) => {
	// Pointer cancel event to stop drawing
	if (event.pointerId !== active_pointer_id) {
		return;
	}
	const action_was_active = isDrawing;
	if (action_was_active) {
		addPointerDistance(getPointerPosition(preview_canvas, event));
	}
	distance_last_pointer_position = null;
	preview_ctx.clearRect(0, 0, window_w, window_h);
	isDrawing = false;
	auto_inc_x_running = 0;
	auto_inc_y_running = 0;
	last_watercolor_deposit = null;
	lastPos = null;
	preview_canvas.releasePointerCapture(event.pointerId);
	active_pointer_id = null;
	if (action_was_active) {
		queuePersistentCanvasSave();
	}
});

preview_canvas.addEventListener("pointermove", (event) => {
	// Event listener for pointer move on preview_canvas (live preview)
	if (active_pointer_id !== null && event.pointerId !== active_pointer_id) {
		return;
	}
	if (event.pointerType !== "mouse" && active_pointer_id === null) {
		return;
	}
	if (event.pointerType !== "mouse") {
		event.preventDefault();
	}
	if (event.pointerType !== "mouse" && !isDrawing) {
		return;
	}
	mousePos = getPointerPosition(preview_canvas, event); // Get pointer coordinates
	if (isDrawing && event.pointerId === active_pointer_id) {
		addPointerDistance(mousePos);
	}

	preview_ctx.clearRect(0, 0, window_w, window_h); // Clear the top canvas before redrawing (avoids smearing of previous drawings)

	if (follow_brush_direction) {
		if (lastPos) {
			const dx = mousePos.x - lastPos.x;
			const dy = mousePos.y - lastPos.y;
			const targetDirection = normalizeVector({ x: dx, y: dy }); // Target direction as a normalized vector
			smoothedDirection = interpolateVector(targetDirection, smoothedDirection, smoothing_factor); // Smooth the direction vector

			// Calculate the angle from the smoothed direction vector
			follow_angle_rads = getAngleFromVector(smoothedDirection);
		}
	}

	if (!isDrawing) {
		px = mousePos.x;
		py = mousePos.y;

		// x = px; y = py;

		if (snap_on) {
			px = Math.round(px / snap_x) * snap_x;
			py = Math.round(py / snap_y) * snap_y;
		}

		if (fx_on) {
			preview_ctx.filter = filters;
		}

		if (mirror_on) {
			mirror_origin = getMirrorOrigin();
		}

		doBrushing(preview_ctx, px, py);
	}

	// Update the last mouse position
	lastPos = mousePos;
});

const keyboard_shortcut_help = [
	{ key: "h", action: "Show or hide the controls", variables: [] },
	{ key: "s", action: "Save the artwork as PNG or GIF", variables: [] },
	{ key: "n / m", action: "Decrease / increase brush size", variables: ["brush_size_increment_y", "brush_height"] },
	{ key: "d / c", action: "Rotate brush left / right", variables: ["manual_inc_rotate", "rotate_angle"] },
	{ key: "f / v (hold)", action: "Hold the brush on the x / y axis", variables: [] },
	{ key: "g / b (hold)", action: "Flip the brush horizontally / vertically", variables: [] },
	{ key: "z / x", action: "Undo / redo", variables: [] },
	{
		key: "1",
		action: "Toggle brush-size automation",
		variables: [
			"brush_size_automation_on",
			"randomise_lock_width_and_height",
			"randomise_width",
			"random_walker_width",
			"randomise_width_range",
			"randomise_width_speed",
			"randomise_width_easing",
			"randomise_height",
			"random_walker_height",
			"randomise_height_range",
			"randomise_height_speed",
			"randomise_height_easing",
		],
	},
	{ key: "2", action: "Toggle follow-brush direction", variables: ["follow_brush_direction", "smoothing_factor"] },
	{ key: "3", action: "Toggle rotation", variables: ["rotate_on", "rotate_angle", "rotate_speed", "auto_rotate", "origin_x", "origin_y"] },
	{
		key: "4",
		action: "Toggle mirror",
		variables: ["mirror_on", "mirror_reflections", "mirror_angle_degrees", "mirror_origin_x", "mirror_origin_y"],
	},
	{ key: "5", action: "Toggle snap", variables: ["snap_on", "snap_x", "snap_y"] },
	{
		key: "6",
		action: "Toggle increment / wave movement",
		variables: [
			"increment_on",
			"auto_inc_x_amount",
			"auto_inc_y_amount",
			"increment_screen_wrap_on",
			"wave_on",
			"x_amp",
			"x_freq",
			"x_phase",
			"y_amp",
			"y_freq",
			"y_phase",
		],
	},
	{
		key: "7",
		action: "Toggle per-stamp FX",
		variables: [
			"fx_on",
			"hue_rotate_on",
			"hue_rotate_amount",
			"auto_hue_rotate_on",
			"auto_hue_increment_amount",
			"brightness_on",
			"brightness_amount",
			"brightness_auto_increment_on",
			"brightness_auto_increment_amount",
			"brightness_ping_pong_on",
			"saturate_on",
			"saturate_amount",
			"saturate_auto_increment_on",
			"saturate_auto_increment_amount",
			"saturate_ping_pong_on",
			"opacity_on",
			"opacity_amount",
			"opacity_auto_increment_on",
			"opacity_auto_increment_amount",
			"opacity_ping_pong_on",
			"invert_on",
			"invert_amount",
			"invert_auto_increment_on",
			"invert_auto_increment_amount",
			"invert_ping_pong_on",
			"blur_on",
			"blur_amount",
			"drop_shadow_on",
			"drop_shadow_color",
			"drop_shadow_x_amount",
			"drop_shadow_y_amount",
			"drop_shadow_blur_amount",
		],
	},
	{ key: "8", action: "Toggle brush blend mode", variables: ["blend_on", "blend_mode"] },
	{
		key: "9",
		action: "Toggle watercolor",
		variables: ["watercolor_on", "watercolor_wetness", "watercolor_pigment", "watercolor_granulation", "watercolor_bleed", "watercolor_blendmode"],
	},
	{
		key: "0",
		action: "Turn all behaviours and effects off",
		variables: [
			"brush_size_automation_on",
			"follow_brush_direction",
			"rotate_on",
			"mirror_on",
			"snap_on",
			"increment_on",
			"fx_on",
			"blend_on",
			"watercolor_on",
		],
	},
	{ key: "a", action: "Randomize brush and effects", variables: ["brush_size_rand_min", "brush_size_rand_max"] },
	{ key: "q", action: "Apply canvas blur", variables: ["canvas_blur_amount"] },
	{ key: "w", action: "Apply canvas invert", variables: ["invert_percentage_amount"] },
	{ key: "e", action: "Apply threshold", variables: ["threshold_level_amount"] },
	{ key: "r", action: "Apply dither", variables: ["dither_pixel_size"] },
	{ key: "t", action: "Apply dilate", variables: [] },
	{ key: "y", action: "Apply erode", variables: [] },
	{ key: "u", action: "Apply emboss", variables: ["emboss_pixel_size_amount"] },
	{ key: "i", action: "Apply edge detection", variables: ["edge_pixel_size_amount"] },
	{ key: "o", action: "Apply glitch", variables: ["glitch_pixel_size", "glitch_amount"] },
	{ key: "p", action: "Apply pixelate", variables: ["pixelate_amount"] },
	{ key: "j", action: "Toggle animated glitch", variables: ["animation_speed", "glitch_pixel_size", "glitch_amount"] },
	{ key: "k", action: "Toggle animated VHS", variables: ["animation_speed"] },
	{ key: "l", action: "Toggle animated dither", variables: ["animation_speed", "dither_pixel_size"] },
	{ key: ";", action: "Toggle animated wave", variables: ["animation_speed", "wave_amplitude", "wave_frequency"] },
];

function help() {
	const rows = keyboard_shortcut_help.map(({ key, action, variables }) => ({
		Key: key,
		Action: action,
		"Change in console": variables.length ? variables.map((name) => `${name} = ${JSON.stringify(window[name])}`).join("; ") : "—",
	}));

	console.log("%cPEPEPAINT keyboard help", "font-weight: bold; font-size: 14px;");
	console.log("Use lowercase keys without Command/Ctrl/Alt/Shift. Shortcuts pause while typing in form fields.");
	console.table(rows);
	console.log("Change any listed setting by assignment, for example: brush_size_increment_y = 10");
	console.log("Run help() again to see the latest values.");
	return rows;
}

function loadTemplateCardImage() {
	return new Promise((resolve, reject) => {
		const templateImage = new Image();
		templateImage.onload = () => resolve(templateImage);
		templateImage.onerror = () => reject(new Error("Could not load the default card template."));
		templateImage.src = "brushes/template02.png";
	});
}

async function drawTemplateCard() {
	const template_image = await loadTemplateCardImage();
	draw_ctx.drawImage(template_image, 0, 0, window_w, window_h);
}

async function initCard() {
	try {
		try {
			const stored_canvas = await getLatestStoredCanvas();
			if (await drawStoredCanvas(stored_canvas)) {
				return;
			}
		} catch (error) {
			warnCanvasStorage("PEPEPAINT could not restore the latest locally saved canvas.", error);
		}

		try {
			await drawTemplateCard();
		} catch (error) {
			console.error(error);
		}
	} finally {
		canvas_is_ready = true;
	}
}

const canvas_initialization_promise = initCard();

async function resetCanvas() {
	await canvas_initialization_promise;
	canvas_is_ready = false;
	window.stopCanvasAnimations?.();
	updateAnimatedFilterButtonStates();
	clearFilters();
	clearBlendMode(draw_ctx);

	try {
		const template_image = await loadTemplateCardImage();
		await waitForPersistentCanvasSaves();
		persistent_canvas_save_requested = false;
		await deleteLatestStoredCanvas();
		number_of_strokes = 0;
		artwork_started_at = null;
		pointer_distance_travelled = 0;
		distance_last_pointer_position = null;
		restoreBrushUsage(null);
		latest_submission_traits = null;

		draw_ctx.clearRect(0, 0, draw_canvas.width, draw_canvas.height);
		preview_ctx.clearRect(0, 0, preview_canvas.width, preview_canvas.height);
		draw_canvas_data.history = [];
		draw_canvas_data.redoStack = [];
		draw_ctx.drawImage(template_image, 0, 0, window_w, window_h);
		showFeedbackNotification("Canvas reset");
		return true;
	} catch (error) {
		console.error("PEPEPAINT could not reset the canvas.", error);
		showFeedbackNotification("Canvas reset failed");
		return false;
	} finally {
		canvas_is_ready = true;
	}
}

window.resetCanvas = resetCanvas;

window.pepepaint = {
	canvas_animation_on: false,
	calculateChaos: (options = {}) => calculateChaos(createFlattenedCanvas(), options),
	calculateDuration: () => calculateDuration(artwork_started_at),
	calculatePepeness: (options = {}) => calculatePepeness(createFlattenedCanvas(), options),
	draw_canvas,
	draw_ctx,
	getDistanceTravelled: () => createDistanceTravelledTrait(pointer_distance_travelled, draw_canvas.width, draw_canvas.height),
	getNumberOfStrokes: () => number_of_strokes,
	getVariety: () => createVarietyTrait(brush_usage),
	getLatestSubmissionTraits: () => latest_submission_traits,
	traits: getPublicTraits,
	window_w,
	window_h,
	clearFilters,
	isCanvasReady: () => canvas_is_ready,
	queuePersistentCanvasSave,
	resetCanvas,
	saveCanvasState,
	setBlendMode: setBrushBlendMode,
	setBlendEnabled: setBrushBlendEnabled,
	getBlendMode: () => blend_mode,
	isBlendEnabled: () => blend_on,
};

// main.js is an ES module, so its top-level `let` values are not automatically
// properties of window. Expose shortcut settings with live getters/setters so
// assignments made in DevTools update the values used by the drawing loop.
const live_fx_console_settings = new Set([
	"hue_rotate_on",
	"hue_rotate_amount",
	"auto_hue_rotate_on",
	"auto_hue_increment_amount",
	"brightness_on",
	"brightness_amount",
	"brightness_auto_increment_on",
	"brightness_auto_increment_amount",
	"brightness_ping_pong_on",
	"saturate_on",
	"saturate_amount",
	"saturate_auto_increment_on",
	"saturate_auto_increment_amount",
	"saturate_ping_pong_on",
	"opacity_on",
	"opacity_amount",
	"opacity_auto_increment_on",
	"opacity_auto_increment_amount",
	"opacity_ping_pong_on",
	"invert_on",
	"invert_amount",
	"invert_auto_increment_on",
	"invert_auto_increment_amount",
	"invert_ping_pong_on",
	"blur_on",
	"blur_amount",
	"drop_shadow_on",
	"drop_shadow_color",
	"drop_shadow_x_amount",
	"drop_shadow_y_amount",
	"drop_shadow_blur_amount",
]);

function exposeConsoleSetting(name, getter, setter) {
	Object.defineProperty(window, name, {
		configurable: true,
		enumerable: true,
		get: getter,
		set: (value) => {
			setter(value);
			if (fx_on && live_fx_console_settings.has(name)) {
				setFilters();
			}
		},
	});
}

const exposeBooleanSetting = (name, getter, setter) => exposeConsoleSetting(name, getter, (value) => setter(Boolean(value)));
const exposeNumberSetting = (name, getter, setter) =>
	exposeConsoleSetting(name, getter, (value) => {
		const next_value = Number(value);
		if (Number.isFinite(next_value)) {
			setter(next_value);
		}
	});

exposeNumberSetting(
	"brush_width",
	() => brush_width,
	(value) => {
		brush_width = value;
		brush_width_float = value;
	},
);
exposeNumberSetting(
	"brush_height",
	() => brush_height,
	(value) => {
		brush_height = value;
		brush_height_float = value;
		syncBrushSizeInputs();
	},
);
exposeNumberSetting(
	"brush_size_increment_x",
	() => brush_size_increment_x,
	(value) => (brush_size_increment_x = value),
);
exposeNumberSetting(
	"brush_size_increment_y",
	() => brush_size_increment_y,
	(value) => (brush_size_increment_y = value),
);
exposeNumberSetting(
	"manual_inc_rotate",
	() => manual_inc_rotate,
	(value) => (manual_inc_rotate = value),
);

exposeBooleanSetting(
	"randomiser_brush_type_on",
	() => randomiser_brush_type_on,
	(value) => (randomiser_brush_type_on = value),
);
exposeBooleanSetting(
	"randomiser_brush_settings_on",
	() => randomiser_brush_settings_on,
	(value) => (randomiser_brush_settings_on = value),
);
exposeBooleanSetting(
	"randomiser_behaviour_type_on",
	() => randomiser_behaviour_type_on,
	(value) => (randomiser_behaviour_type_on = value),
);
exposeBooleanSetting(
	"randomiser_behaviour_settings_on",
	() => randomiser_behaviour_settings_on,
	(value) => (randomiser_behaviour_settings_on = value),
);
exposeBooleanSetting(
	"randomiser_brush_size_on",
	() => randomiser_brush_size_on,
	(value) => (randomiser_brush_size_on = value),
);
exposeNumberSetting(
	"randomiser_brush_size_min",
	() => randomiser_brush_size_min,
	(value) => (randomiser_brush_size_min = value),
);
exposeNumberSetting(
	"randomiser_brush_size_max",
	() => randomiser_brush_size_max,
	(value) => (randomiser_brush_size_max = value),
);
exposeNumberSetting(
	"brush_size_rand_min",
	() => brush_size_rand_min,
	(value) => (brush_size_rand_min = value),
);
exposeNumberSetting(
	"brush_size_rand_max",
	() => brush_size_rand_max,
	(value) => (brush_size_rand_max = value),
);
exposeBooleanSetting(
	"drawing_speed_on",
	() => drawing_speed_on,
	(value) => (drawing_speed_on = value),
);
exposeNumberSetting(
	"drawing_speed",
	() => drawing_speed,
	(value) => (drawing_speed = value),
);

exposeBooleanSetting("brush_size_automation_on", () => brush_size_automation_on, setBrushSizeAutomation);
exposeBooleanSetting(
	"randomise_lock_width_and_height",
	() => randomise_lock_width_and_height,
	(value) => (randomise_lock_width_and_height = value),
);
exposeBooleanSetting(
	"randomise_width",
	() => randomise_width,
	(value) => {
		randomise_width = value;
		initRandomWalkers();
	},
);
exposeBooleanSetting(
	"random_walker_width",
	() => random_walker_width,
	(value) => {
		random_walker_width = value;
		initRandomWalkers();
	},
);
exposeNumberSetting(
	"randomise_width_range",
	() => randomise_width_range,
	(value) => {
		randomise_width_range = value;
		initRandomWalkers();
	},
);
exposeNumberSetting(
	"randomise_width_speed",
	() => randomise_width_speed,
	(value) => {
		randomise_width_speed = value;
		initRandomWalkers();
	},
);
exposeNumberSetting(
	"randomise_width_easing",
	() => randomise_width_easing,
	(value) => {
		randomise_width_easing = value;
		initRandomWalkers();
	},
);
exposeBooleanSetting(
	"randomise_height",
	() => randomise_height,
	(value) => {
		randomise_height = value;
		initRandomWalkers();
	},
);
exposeBooleanSetting(
	"random_walker_height",
	() => random_walker_height,
	(value) => {
		random_walker_height = value;
		initRandomWalkers();
	},
);
exposeNumberSetting(
	"randomise_height_range",
	() => randomise_height_range,
	(value) => {
		randomise_height_range = value;
		initRandomWalkers();
	},
);
exposeNumberSetting(
	"randomise_height_speed",
	() => randomise_height_speed,
	(value) => {
		randomise_height_speed = value;
		initRandomWalkers();
	},
);
exposeNumberSetting(
	"randomise_height_easing",
	() => randomise_height_easing,
	(value) => {
		randomise_height_easing = value;
		initRandomWalkers();
	},
);

exposeBooleanSetting(
	"follow_brush_direction",
	() => follow_brush_direction,
	(value) => (follow_brush_direction = value),
);
exposeNumberSetting(
	"smoothing_factor",
	() => smoothing_factor,
	(value) => (smoothing_factor = value),
);

exposeBooleanSetting(
	"rotate_on",
	() => rotate_on,
	(value) => (rotate_on = value),
);
exposeNumberSetting(
	"rotate_angle",
	() => rotate_angle,
	(value) => {
		rotate_angle = value;
		rotate_angle_rads = rotate_angle * (Math.PI / 180);
	},
);
exposeNumberSetting(
	"rotate_speed",
	() => rotate_speed,
	(value) => (rotate_speed = value),
);
exposeBooleanSetting(
	"auto_rotate",
	() => auto_rotate,
	(value) => (auto_rotate = value),
);
exposeNumberSetting(
	"origin_x",
	() => origin_x,
	(value) => (origin_x = value),
);
exposeNumberSetting(
	"origin_y",
	() => origin_y,
	(value) => (origin_y = value),
);

exposeBooleanSetting(
	"mirror_on",
	() => mirror_on,
	(value) => (mirror_on = value),
);
exposeNumberSetting(
	"mirror_reflections",
	() => mirror_reflections,
	(value) => (mirror_reflections = value),
);
exposeNumberSetting(
	"mirror_angle_degrees",
	() => mirror_angle_degrees,
	(value) => {
		mirror_angle_degrees = value;
		mirror_angle_rads = (mirror_angle_degrees * Math.PI) / 180;
	},
);
exposeNumberSetting(
	"mirror_origin_x",
	() => mirror_origin_x,
	(value) => (mirror_origin_x = value),
);
exposeNumberSetting(
	"mirror_origin_y",
	() => mirror_origin_y,
	(value) => (mirror_origin_y = value),
);

exposeBooleanSetting(
	"snap_on",
	() => snap_on,
	(value) => (snap_on = value),
);
exposeNumberSetting(
	"snap_x",
	() => snap_x,
	(value) => (snap_x = value),
);
exposeNumberSetting(
	"snap_y",
	() => snap_y,
	(value) => (snap_y = value),
);

exposeBooleanSetting(
	"increment_on",
	() => increment_on,
	(value) => (increment_on = value),
);
exposeNumberSetting(
	"auto_inc_x_amount",
	() => auto_inc_x_amount,
	(value) => (auto_inc_x_amount = value),
);
exposeNumberSetting(
	"auto_inc_y_amount",
	() => auto_inc_y_amount,
	(value) => (auto_inc_y_amount = value),
);
exposeBooleanSetting(
	"increment_screen_wrap_on",
	() => increment_screen_wrap_on,
	(value) => (increment_screen_wrap_on = value),
);
exposeBooleanSetting(
	"wave_on",
	() => wave_on,
	(value) => (wave_on = value),
);
exposeNumberSetting(
	"x_amp",
	() => x_amp,
	(value) => (x_amp = value),
);
exposeNumberSetting(
	"x_freq",
	() => x_freq,
	(value) => (x_freq = value),
);
exposeNumberSetting(
	"x_phase",
	() => x_phase,
	(value) => (x_phase = value),
);
exposeNumberSetting(
	"y_amp",
	() => y_amp,
	(value) => (y_amp = value),
);
exposeNumberSetting(
	"y_freq",
	() => y_freq,
	(value) => (y_freq = value),
);
exposeNumberSetting(
	"y_phase",
	() => y_phase,
	(value) => (y_phase = value),
);

exposeBooleanSetting(
	"fx_on",
	() => fx_on,
	(value) => {
		fx_on = value;
		setFilters();
	},
);
exposeBooleanSetting(
	"hue_rotate_on",
	() => hue_rotate_on,
	(value) => (hue_rotate_on = value),
);
exposeNumberSetting(
	"hue_rotate_amount",
	() => hue_rotate_amount,
	(value) => (hue_rotate_amount = value),
);
exposeBooleanSetting(
	"auto_hue_rotate_on",
	() => auto_hue_rotate_on,
	(value) => (auto_hue_rotate_on = value),
);
exposeNumberSetting(
	"auto_hue_increment_amount",
	() => auto_hue_increment_amount,
	(value) => (auto_hue_increment_amount = value),
);
exposeBooleanSetting(
	"brightness_on",
	() => brightness_on,
	(value) => (brightness_on = value),
);
exposeNumberSetting(
	"brightness_amount",
	() => brightness_amount,
	(value) => (brightness_amount = value),
);
exposeBooleanSetting(
	"brightness_auto_increment_on",
	() => brightness_auto_increment_on,
	(value) => (brightness_auto_increment_on = value),
);
exposeNumberSetting(
	"brightness_auto_increment_amount",
	() => brightness_auto_increment_amount,
	(value) => (brightness_auto_increment_amount = value),
);
exposeBooleanSetting(
	"brightness_ping_pong_on",
	() => brightness_ping_pong_on,
	(value) => (brightness_ping_pong_on = value),
);
exposeBooleanSetting(
	"saturate_on",
	() => saturate_on,
	(value) => (saturate_on = value),
);
exposeNumberSetting(
	"saturate_amount",
	() => saturate_amount,
	(value) => (saturate_amount = value),
);
exposeBooleanSetting(
	"saturate_auto_increment_on",
	() => saturate_auto_increment_on,
	(value) => (saturate_auto_increment_on = value),
);
exposeNumberSetting(
	"saturate_auto_increment_amount",
	() => saturate_auto_increment_amount,
	(value) => (saturate_auto_increment_amount = value),
);
exposeBooleanSetting(
	"saturate_ping_pong_on",
	() => saturate_ping_pong_on,
	(value) => (saturate_ping_pong_on = value),
);
exposeBooleanSetting(
	"opacity_on",
	() => opacity_on,
	(value) => (opacity_on = value),
);
exposeNumberSetting(
	"opacity_amount",
	() => opacity_amount,
	(value) => (opacity_amount = value),
);
exposeBooleanSetting(
	"opacity_auto_increment_on",
	() => opacity_auto_increment_on,
	(value) => (opacity_auto_increment_on = value),
);
exposeNumberSetting(
	"opacity_auto_increment_amount",
	() => opacity_auto_increment_amount,
	(value) => (opacity_auto_increment_amount = value),
);
exposeBooleanSetting(
	"opacity_ping_pong_on",
	() => opacity_ping_pong_on,
	(value) => (opacity_ping_pong_on = value),
);
exposeBooleanSetting(
	"invert_on",
	() => invert_on,
	(value) => (invert_on = value),
);
exposeNumberSetting(
	"invert_amount",
	() => invert_amount,
	(value) => (invert_amount = value),
);
exposeBooleanSetting(
	"invert_auto_increment_on",
	() => invert_auto_increment_on,
	(value) => (invert_auto_increment_on = value),
);
exposeNumberSetting(
	"invert_auto_increment_amount",
	() => invert_auto_increment_amount,
	(value) => (invert_auto_increment_amount = value),
);
exposeBooleanSetting(
	"invert_ping_pong_on",
	() => invert_ping_pong_on,
	(value) => (invert_ping_pong_on = value),
);
exposeBooleanSetting(
	"blur_on",
	() => blur_on,
	(value) => (blur_on = value),
);
exposeNumberSetting(
	"blur_amount",
	() => blur_amount,
	(value) => (blur_amount = value),
);
exposeBooleanSetting(
	"drop_shadow_on",
	() => drop_shadow_on,
	(value) => (drop_shadow_on = value),
);
exposeConsoleSetting(
	"drop_shadow_color",
	() => drop_shadow_color,
	(value) => {
		drop_shadow_color = String(value);
		drop_shadow_color_rgb = hexToRgba(drop_shadow_color);
	},
);
exposeNumberSetting(
	"drop_shadow_x_amount",
	() => drop_shadow_x_amount,
	(value) => (drop_shadow_x_amount = value),
);
exposeNumberSetting(
	"drop_shadow_y_amount",
	() => drop_shadow_y_amount,
	(value) => (drop_shadow_y_amount = value),
);
exposeNumberSetting(
	"drop_shadow_blur_amount",
	() => drop_shadow_blur_amount,
	(value) => (drop_shadow_blur_amount = value),
);

exposeBooleanSetting(
	"watercolor_on",
	() => watercolor_on,
	(value) => {
		watercolor_on = value;
		last_watercolor_deposit = null;
	},
);
exposeNumberSetting(
	"watercolor_wetness",
	() => watercolor_wetness,
	(value) => (watercolor_wetness = clamp01(value)),
);
exposeNumberSetting(
	"watercolor_pigment",
	() => watercolor_pigment,
	(value) => (watercolor_pigment = clamp01(value)),
);
exposeNumberSetting(
	"watercolor_granulation",
	() => watercolor_granulation,
	(value) => (watercolor_granulation = clamp01(value)),
);
exposeNumberSetting(
	"watercolor_bleed",
	() => watercolor_bleed,
	(value) => (watercolor_bleed = Math.max(0, value)),
);
exposeConsoleSetting("watercolor_blendmode", () => watercolor_blendmode, setWatercolorBlendMode);

exposeConsoleSetting("blend_mode", () => blend_mode, setBrushBlendMode);
exposeBooleanSetting("blend_on", () => blend_on, setBrushBlendEnabled);
window.help = help;
window.addEventListener("load", help, { once: true });
