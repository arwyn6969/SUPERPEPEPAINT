export const PEPE_PALETTE = Object.freeze(["#588B3D", "#A55A35", "#DA291C", "#D99CFF", "#000000", "#FFFFFF", "#0344FF"]);

const PEPENESS_ALGORITHM_VERSION = 1;
const STROKE_COUNT_ALGORITHM_VERSION = 1;
const DURATION_ALGORITHM_VERSION = 1;
const DISTANCE_TRAVELLED_ALGORITHM_VERSION = 1;
const CHAOS_ALGORITHM_VERSION = 1;
const VARIETY_ALGORITHM_VERSION = 1;
const DEFAULT_PEPENESS_TOLERANCE = 40;
const DEFAULT_CHAOS_SAMPLE_WIDTH = 200;
const CHAOS_COLOR_ENTROPY_WEIGHT = 0.4;
const CHAOS_EDGE_DENSITY_WEIGHT = 0.35;
const CHAOS_LOCAL_UNPREDICTABILITY_WEIGHT = 0.25;
const CHAOS_EDGE_THRESHOLD = 35;
const CHAOS_LOCAL_THRESHOLD = 45;
const CHAOS_TARGET_COLOR_ENTROPY = 6;

function hexToRgb(hex_color) {
	const match = /^#([0-9a-f]{6})$/i.exec(hex_color);
	if (!match) {
		throw new TypeError(`Invalid PEPENESS palette color: ${hex_color}`);
	}

	const value = Number.parseInt(match[1], 16);
	return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function preparePepenessOptions(tolerance, palette) {
	const numeric_tolerance = Number(tolerance);
	if (!Number.isFinite(numeric_tolerance) || numeric_tolerance < 0) {
		throw new RangeError("PEPENESS tolerance must be a non-negative number.");
	}

	if (!Array.isArray(palette) || palette.length === 0) {
		throw new TypeError("PEPENESS palette must contain at least one hex color.");
	}

	return {
		numeric_tolerance,
		palette_rgb: palette.map(hexToRgb),
		tolerance_squared: numeric_tolerance * numeric_tolerance,
	};
}

export function calculatePepenessFromImageData(image_data, { tolerance = DEFAULT_PEPENESS_TOLERANCE, palette = PEPE_PALETTE } = {}) {
	if (!image_data || !Number.isInteger(image_data.width) || !Number.isInteger(image_data.height) || !ArrayBuffer.isView(image_data.data)) {
		throw new TypeError("calculatePepenessFromImageData requires ImageData-compatible pixel data.");
	}

	const width = image_data.width;
	const height = image_data.height;
	const total_pixels = width * height;
	if (width < 0 || height < 0 || image_data.data.length < total_pixels * 4) {
		throw new RangeError("PEPENESS pixel data does not match its dimensions.");
	}

	const { numeric_tolerance, palette_rgb, tolerance_squared } = preparePepenessOptions(tolerance, palette);
	const pixels = image_data.data;
	let matched_coverage = 0;

	for (let i = 0; i < pixels.length; i += 4) {
		const alpha = pixels[i + 3] / 255;
		if (alpha === 0) continue;

		const red = pixels[i];
		const green = pixels[i + 1];
		const blue = pixels[i + 2];

		for (const [pepe_red, pepe_green, pepe_blue] of palette_rgb) {
			const red_difference = red - pepe_red;
			const green_difference = green - pepe_green;
			const blue_difference = blue - pepe_blue;
			const distance_squared = red_difference * red_difference + green_difference * green_difference + blue_difference * blue_difference;

			if (distance_squared <= tolerance_squared) {
				matched_coverage += alpha;
				break;
			}
		}
	}

	const percentage = total_pixels === 0 ? 0 : (matched_coverage / total_pixels) * 100;

	return {
		name: "PEPENESS",
		value: Math.round(percentage * 100) / 100,
		matched_coverage: Math.round(matched_coverage * 1000) / 1000,
		total_pixels,
		tolerance: numeric_tolerance,
		palette: [...palette],
		algorithm_version: PEPENESS_ALGORITHM_VERSION,
	};
}

export function calculatePepeness(canvas, options = {}) {
	if (typeof HTMLCanvasElement === "undefined" || !(canvas instanceof HTMLCanvasElement)) {
		throw new TypeError("calculatePepeness requires an HTMLCanvasElement.");
	}

	const context = canvas.getContext("2d", { willReadFrequently: true });
	if (!context) {
		throw new Error("Could not read the canvas for PEPENESS analysis.");
	}

	return calculatePepenessFromImageData(context.getImageData(0, 0, canvas.width, canvas.height), options);
}

export function createNumberOfStrokesTrait(stroke_count) {
	if (!Number.isSafeInteger(stroke_count) || stroke_count < 0) {
		throw new RangeError("Number of Strokes must be a non-negative integer.");
	}

	return {
		name: "NUMBER OF STROKES",
		value: stroke_count,
		algorithm_version: STROKE_COUNT_ALGORITHM_VERSION,
	};
}

function formatDuration(duration_ms) {
	const total_seconds = Math.floor(duration_ms / 1000);
	const days = Math.floor(total_seconds / 86400);
	const hours = Math.floor((total_seconds % 86400) / 3600);
	const minutes = Math.floor((total_seconds % 3600) / 60);
	const seconds = total_seconds % 60;
	const clock = [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");

	return days > 0 ? `${days}d ${clock}` : clock;
}

export function calculateDuration(started_at, ended_at = Date.now()) {
	const numeric_ended_at = Number(ended_at);
	if (!Number.isFinite(numeric_ended_at) || numeric_ended_at < 0) {
		throw new RangeError("Duration end time must be a valid timestamp.");
	}

	const has_started = Number.isFinite(started_at) && started_at >= 0;
	const numeric_started_at = has_started ? Number(started_at) : null;
	const duration_ms = has_started ? Math.max(0, Math.round(numeric_ended_at - numeric_started_at)) : 0;

	return {
		name: "DURATION",
		value: Math.round((duration_ms / 1000) * 1000) / 1000,
		unit: "seconds",
		duration_ms,
		formatted: formatDuration(duration_ms),
		started_at: has_started ? new Date(numeric_started_at).toISOString() : null,
		ended_at: new Date(numeric_ended_at).toISOString(),
		has_started,
		algorithm_version: DURATION_ALGORITHM_VERSION,
	};
}

export function createDistanceTravelledTrait(distance, canvas_width, canvas_height) {
	if (!Number.isFinite(distance) || distance < 0) {
		throw new RangeError("Distance Travelled must be a non-negative number.");
	}
	if (!Number.isFinite(canvas_width) || canvas_width < 0 || !Number.isFinite(canvas_height) || canvas_height < 0) {
		throw new RangeError("Distance Travelled requires valid canvas dimensions.");
	}

	const canvas_diagonal = Math.hypot(canvas_width, canvas_height);
	const rounded_distance = Math.round(distance * 100) / 100;

	return {
		name: "DISTANCE TRAVELLED",
		value: rounded_distance,
		unit: "canvas_pixels",
		formatted: `${Math.round(distance).toLocaleString()} px`,
		canvas_lengths: canvas_diagonal === 0 ? 0 : Math.round((distance / canvas_diagonal) * 1000) / 1000,
		algorithm_version: DISTANCE_TRAVELLED_ALGORITHM_VERSION,
	};
}

export function createVarietyTrait(brush_usage) {
	if (!brush_usage || typeof brush_usage !== "object" || Array.isArray(brush_usage)) {
		throw new TypeError("Variety requires a brush usage object.");
	}

	const usage_entries = Object.entries(brush_usage)
		.filter(([brush_name, stroke_count]) => brush_name.length > 0 && Number.isSafeInteger(stroke_count) && stroke_count > 0)
		.sort(([first_name], [second_name]) => first_name.localeCompare(second_name));
	const normalized_usage = Object.fromEntries(usage_entries);

	return {
		name: "VARIETY",
		value: usage_entries.length,
		unit: "unique_brushes",
		brushes_used: usage_entries.map(([brush_name]) => brush_name),
		brush_usage: normalized_usage,
		algorithm_version: VARIETY_ALGORITHM_VERSION,
	};
}

function roundPercentage(value) {
	return Math.round(Math.max(0, Math.min(100, value)) * 100) / 100;
}

export function calculateChaosFromImageData(image_data) {
	if (!image_data || !Number.isInteger(image_data.width) || !Number.isInteger(image_data.height) || !ArrayBuffer.isView(image_data.data)) {
		throw new TypeError("calculateChaosFromImageData requires ImageData-compatible pixel data.");
	}

	const width = image_data.width;
	const height = image_data.height;
	const total_pixels = width * height;
	if (width < 1 || height < 1 || image_data.data.length < total_pixels * 4) {
		throw new RangeError("Chaos pixel data does not match its dimensions.");
	}

	const source = image_data.data;
	const rgb = new Uint8Array(total_pixels * 3);
	const color_buckets = new Map();

	for (let pixel_index = 0; pixel_index < total_pixels; pixel_index++) {
		const source_index = pixel_index * 4;
		const rgb_index = pixel_index * 3;
		const alpha = source[source_index + 3] / 255;
		const inverse_alpha = 1 - alpha;
		const red = Math.round(source[source_index] * alpha + 255 * inverse_alpha);
		const green = Math.round(source[source_index + 1] * alpha + 255 * inverse_alpha);
		const blue = Math.round(source[source_index + 2] * alpha + 255 * inverse_alpha);

		rgb[rgb_index] = red;
		rgb[rgb_index + 1] = green;
		rgb[rgb_index + 2] = blue;

		const bucket = ((red >> 4) << 8) | ((green >> 4) << 4) | (blue >> 4);
		color_buckets.set(bucket, (color_buckets.get(bucket) || 0) + 1);
	}

	let color_entropy_bits = 0;
	for (const count of color_buckets.values()) {
		const probability = count / total_pixels;
		color_entropy_bits -= probability * Math.log2(probability);
	}
	const color_entropy = roundPercentage((color_entropy_bits / CHAOS_TARGET_COLOR_ENTROPY) * 100);

	const edge_threshold_squared = CHAOS_EDGE_THRESHOLD * CHAOS_EDGE_THRESHOLD;
	let edge_matches = 0;
	let edge_comparisons = 0;

	function compareEdge(first_pixel, second_pixel) {
		const first_index = first_pixel * 3;
		const second_index = second_pixel * 3;
		const red_difference = rgb[first_index] - rgb[second_index];
		const green_difference = rgb[first_index + 1] - rgb[second_index + 1];
		const blue_difference = rgb[first_index + 2] - rgb[second_index + 2];
		edge_comparisons += 1;
		if (
			red_difference * red_difference + green_difference * green_difference + blue_difference * blue_difference >=
			edge_threshold_squared
		) {
			edge_matches += 1;
		}
	}

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const pixel_index = y * width + x;
			if (x + 1 < width) compareEdge(pixel_index, pixel_index + 1);
			if (y + 1 < height) compareEdge(pixel_index, pixel_index + width);
		}
	}
	const edge_density = roundPercentage(edge_comparisons === 0 ? 0 : (edge_matches / edge_comparisons) * 100);

	const local_threshold_squared = CHAOS_LOCAL_THRESHOLD * CHAOS_LOCAL_THRESHOLD;
	let unpredictable_pixels = 0;
	let local_comparisons = 0;

	for (let y = 1; y < height - 1; y++) {
		for (let x = 1; x < width - 1; x++) {
			const center_pixel = y * width + x;
			const center_index = center_pixel * 3;
			let red_total = 0;
			let green_total = 0;
			let blue_total = 0;

			for (let offset_y = -1; offset_y <= 1; offset_y++) {
				for (let offset_x = -1; offset_x <= 1; offset_x++) {
					if (offset_x === 0 && offset_y === 0) continue;
					const neighbor_index = ((y + offset_y) * width + x + offset_x) * 3;
					red_total += rgb[neighbor_index];
					green_total += rgb[neighbor_index + 1];
					blue_total += rgb[neighbor_index + 2];
				}
			}

			const red_difference = rgb[center_index] - red_total / 8;
			const green_difference = rgb[center_index + 1] - green_total / 8;
			const blue_difference = rgb[center_index + 2] - blue_total / 8;
			local_comparisons += 1;
			if (
				red_difference * red_difference + green_difference * green_difference + blue_difference * blue_difference >=
				local_threshold_squared
			) {
				unpredictable_pixels += 1;
			}
		}
	}
	const local_unpredictability = roundPercentage(
		local_comparisons === 0 ? 0 : (unpredictable_pixels / local_comparisons) * 100,
	);

	const chaos = roundPercentage(
		color_entropy * CHAOS_COLOR_ENTROPY_WEIGHT +
			edge_density * CHAOS_EDGE_DENSITY_WEIGHT +
			local_unpredictability * CHAOS_LOCAL_UNPREDICTABILITY_WEIGHT,
	);

	return {
		name: "CHAOS",
		value: chaos,
		unit: "percent",
		components: {
			color_entropy,
			edge_density,
			local_unpredictability,
		},
		sample_width: width,
		sample_height: height,
		algorithm_version: CHAOS_ALGORITHM_VERSION,
	};
}

export function calculateChaos(canvas, { sample_width = DEFAULT_CHAOS_SAMPLE_WIDTH } = {}) {
	if (typeof HTMLCanvasElement === "undefined" || !(canvas instanceof HTMLCanvasElement)) {
		throw new TypeError("calculateChaos requires an HTMLCanvasElement.");
	}
	if (!Number.isSafeInteger(sample_width) || sample_width < 1) {
		throw new RangeError("Chaos sample width must be a positive integer.");
	}
	if (canvas.width < 1 || canvas.height < 1) {
		throw new RangeError("Chaos requires a non-empty canvas.");
	}

	const sample_canvas = document.createElement("canvas");
	sample_canvas.width = Math.min(sample_width, canvas.width);
	sample_canvas.height = Math.max(1, Math.round(canvas.height * (sample_canvas.width / canvas.width)));
	const sample_context = sample_canvas.getContext("2d", { willReadFrequently: true });
	if (!sample_context) {
		throw new Error("Could not create a canvas for Chaos analysis.");
	}

	sample_context.imageSmoothingEnabled = true;
	sample_context.imageSmoothingQuality = "high";
	sample_context.drawImage(canvas, 0, 0, sample_canvas.width, sample_canvas.height);
	return calculateChaosFromImageData(sample_context.getImageData(0, 0, sample_canvas.width, sample_canvas.height));
}
