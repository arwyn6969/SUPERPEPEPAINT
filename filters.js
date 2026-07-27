////////////////////////////
//     CANVAS FILTERS     //
////////////////////////////

// static: blur, invert, threshold, dither, dilate, erode, emboss, edges, pixelate, glitch
// animated: glitch, vhs, possibly dither?

let canvas_blur_amount = 2;
let invert_percentage_amount = 100;
let sepia_percentage_amount = 100;
let threshold_level_amount = 128;
let posterize_levels_amount = 3;
let dither_pixel_size = 2;
let solarize_threshold_amount = 128;
let emboss_pixel_size_amount = 1;
let edge_pixel_size_amount = 3;
let pixelate_amount = 4;
let glitch_pixel_size = 10;
let glitch_amount = 5;
let crt_pixel_size_amount = 5;

let animation_speed = 10;
let animated_glitch_on = false;
let animated_vhs_on = false;
let animated_dither_on = false;
let animated_wave_on = false;
let wave_amplitude = 4;
let wave_frequency = 6;
let wave_vertical_offset = 0;
const wave_vertical_speed = 2;
let animation_frame = null;
let animation_base_canvas = null;
let animation_last_update_time = -animation_speed;

function setFilterNumber(value, fallback) {
	const number = Number(value);
	return Number.isFinite(number) ? number : fallback;
}

Object.defineProperties(window, {
	animated_glitch_on: {
		get: () => animated_glitch_on,
	},
	animated_vhs_on: {
		get: () => animated_vhs_on,
	},
	animated_dither_on: {
		get: () => animated_dither_on,
	},
	animated_wave_on: {
		get: () => animated_wave_on,
	},
	wave_amplitude: {
		get: () => wave_amplitude,
		set: (value) => (wave_amplitude = Math.max(0, setFilterNumber(value, wave_amplitude))),
	},
	wave_frequency: {
		get: () => wave_frequency,
		set: (value) => (wave_frequency = Math.max(0, setFilterNumber(value, wave_frequency))),
	},
	canvas_blur_amount: {
		get: () => canvas_blur_amount,
		set: (value) => (canvas_blur_amount = setFilterNumber(value, canvas_blur_amount)),
	},
	invert_percentage_amount: {
		get: () => invert_percentage_amount,
		set: (value) => (invert_percentage_amount = setFilterNumber(value, invert_percentage_amount)),
	},
	sepia_percentage_amount: {
		get: () => sepia_percentage_amount,
		set: (value) => (sepia_percentage_amount = setFilterNumber(value, sepia_percentage_amount)),
	},
	threshold_level_amount: {
		get: () => threshold_level_amount,
		set: (value) => (threshold_level_amount = setFilterNumber(value, threshold_level_amount)),
	},
	posterize_levels_amount: {
		get: () => posterize_levels_amount,
		set: (value) => (posterize_levels_amount = setFilterNumber(value, posterize_levels_amount)),
	},
	dither_pixel_size: {
		get: () => dither_pixel_size,
		set: (value) => (dither_pixel_size = setFilterNumber(value, dither_pixel_size)),
	},
	solarize_threshold_amount: {
		get: () => solarize_threshold_amount,
		set: (value) => (solarize_threshold_amount = setFilterNumber(value, solarize_threshold_amount)),
	},
	emboss_pixel_size_amount: {
		get: () => emboss_pixel_size_amount,
		set: (value) => (emboss_pixel_size_amount = setFilterNumber(value, emboss_pixel_size_amount)),
	},
	edge_pixel_size_amount: {
		get: () => edge_pixel_size_amount,
		set: (value) => (edge_pixel_size_amount = setFilterNumber(value, edge_pixel_size_amount)),
	},
	pixelate_amount: {
		get: () => pixelate_amount,
		set: (value) => (pixelate_amount = setFilterNumber(value, pixelate_amount)),
	},
	glitch_pixel_size: {
		get: () => glitch_pixel_size,
		set: (value) => (glitch_pixel_size = setFilterNumber(value, glitch_pixel_size)),
	},
	glitch_amount: {
		get: () => glitch_amount,
		set: (value) => (glitch_amount = setFilterNumber(value, glitch_amount)),
	},
	crt_pixel_size_amount: {
		get: () => crt_pixel_size_amount,
		set: (value) => (crt_pixel_size_amount = setFilterNumber(value, crt_pixel_size_amount)),
	},
	animation_speed: {
		get: () => animation_speed,
		set: (value) => (animation_speed = Math.max(0, setFilterNumber(value, animation_speed))),
	},
});

const { draw_canvas, draw_ctx, window_w, window_h, clearFilters, saveCanvasState } = window.pepepaint;

function blurr() {
	clearFilters();

	const tempCanvas = document.createElement("canvas");
	const tempCtx = tempCanvas.getContext("2d");
	tempCanvas.width = window_w;
	tempCanvas.height = window_h;

	tempCtx.imageSmoothingEnabled = true;
	draw_canvas.imageSmoothingEnabled = true;

	tempCtx.drawImage(draw_canvas, 0, 0, window_w, window_h);

	saveCanvasState();

	draw_ctx.clearRect(0, 0, window_w, window_h);

	draw_ctx.filter = `blur(${canvas_blur_amount}px)`;

	draw_ctx.drawImage(tempCanvas, 0, 0, window_w, window_h);

	clearFilters();
}

function invert() {
	clearFilters();

	const tempCanvas = document.createElement("canvas");
	const tempCtx = tempCanvas.getContext("2d");
	tempCanvas.width = window_w;
	tempCanvas.height = window_h;

	tempCtx.imageSmoothingEnabled = true;
	draw_canvas.imageSmoothingEnabled = true;

	tempCtx.drawImage(draw_canvas, 0, 0, window_w, window_h);

	saveCanvasState();

	draw_ctx.clearRect(0, 0, window_w, window_h);

	draw_ctx.filter = `invert(${invert_percentage_amount}%)`;

	draw_ctx.drawImage(tempCanvas, 0, 0, window_w, window_h);

	clearFilters();
}

function sepia() {
	clearFilters();

	const tempCanvas = document.createElement("canvas");
	const tempCtx = tempCanvas.getContext("2d");
	tempCanvas.width = window_w;
	tempCanvas.height = window_h;

	tempCtx.imageSmoothingEnabled = true;
	draw_canvas.imageSmoothingEnabled = true;

	tempCtx.drawImage(draw_canvas, 0, 0, window_w, window_h);

	saveCanvasState();

	draw_ctx.clearRect(0, 0, window_w, window_h);

	draw_ctx.filter = `sepia(${sepia_percentage_amount}%)`;

	draw_ctx.drawImage(tempCanvas, 0, 0, window_w, window_h);

	clearFilters();
}

function threshold() {
	saveCanvasState();

	const imageData = draw_ctx.getImageData(0, 0, draw_canvas.width, draw_canvas.height);
	const data = imageData.data;

	for (let i = 0; i < data.length; i += 4) {
		const brightness = 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2];
		const value = brightness >= threshold_level_amount ? 255 : 0;

		data[i] = value; // Red
		data[i + 1] = value; // Green
		data[i + 2] = value; // Blue
	}

	draw_ctx.putImageData(imageData, 0, 0);
}

function monochrome() {
	saveCanvasState();

	const imageData = draw_ctx.getImageData(0, 0, draw_canvas.width, draw_canvas.height);
	const data = imageData.data;

	for (let i = 0; i < data.length; i += 4) {
		const gray = 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2];

		data[i] = gray; // Red
		data[i + 1] = gray; // Green
		data[i + 2] = gray; // Blue
	}

	draw_ctx.putImageData(imageData, 0, 0);
}

function posterize() {
	saveCanvasState();

	const imageData = draw_ctx.getImageData(0, 0, draw_canvas.width, draw_canvas.height);
	const data = imageData.data;
	const levelCount = Number.isFinite(posterize_levels_amount) ? Math.max(2, Math.floor(posterize_levels_amount)) : 2;
	const step = 255 / (levelCount - 1);

	for (let i = 0; i < data.length; i += 4) {
		data[i] = Math.round(data[i] / step) * step; // Red
		data[i + 1] = Math.round(data[i + 1] / step) * step; // Green
		data[i + 2] = Math.round(data[i + 2] / step) * step; // Blue
	}

	draw_ctx.putImageData(imageData, 0, 0);
}

function applyDitherToCanvas(context, canvas, { seed = Math.floor(Math.random() * 0xffffffff), randomness = 32 } = {}, save_history = true) {
	if (save_history) {
		saveCanvasState();
	}

	const width = canvas.width;
	const height = canvas.height;
	const imageData = context.getImageData(0, 0, width, height);
	const data = imageData.data;
	const pixelSize = Math.max(1, dither_pixel_size | 0);

	// Seeded pseudo-random number generator.
	const createRandom = (initialSeed) => {
		let state = initialSeed >>> 0;

		return () => {
			state += 0x6d2b79f5;

			let value = state;
			value = Math.imul(value ^ (value >>> 15), value | 1);
			value ^= value + Math.imul(value ^ (value >>> 7), value | 61);

			return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
		};
	};

	const random = createRandom(seed);

	const getBlockAverage = (startX, startY) => {
		const endX = Math.min(startX + pixelSize, width);
		const endY = Math.min(startY + pixelSize, height);

		let r = 0;
		let g = 0;
		let b = 0;
		let a = 0;
		let count = 0;

		for (let y = startY; y < endY; y++) {
			for (let x = startX; x < endX; x++) {
				const index = (y * width + x) * 4;

				r += data[index];
				g += data[index + 1];
				b += data[index + 2];
				a += data[index + 3];

				count++;
			}
		}

		if (count === 0) {
			return [0, 0, 0, 0];
		}

		return [r / count, g / count, b / count, a / count];
	};

	const gridW = Math.ceil(width / pixelSize);
	const gridH = Math.ceil(height / pixelSize);
	const gridSize = gridW * gridH;

	const rVals = new Float32Array(gridSize);
	const gVals = new Float32Array(gridSize);
	const bVals = new Float32Array(gridSize);
	const aVals = new Uint8ClampedArray(gridSize);

	for (let gy = 0; gy < gridH; gy++) {
		for (let gx = 0; gx < gridW; gx++) {
			const [r, g, b, a] = getBlockAverage(gx * pixelSize, gy * pixelSize);

			const index = gy * gridW + gx;

			rVals[index] = r;
			gVals[index] = g;
			bVals[index] = b;
			aVals[index] = Math.round(a);
		}
	}

	const diffuse = (values, index, error, x, y, direction) => {
		const nextX = x + direction;

		if (nextX >= 0 && nextX < gridW) {
			values[index + direction] += error * (7 / 16);
		}

		if (y + 1 >= gridH) {
			return;
		}

		const belowIndex = index + gridW;

		values[belowIndex] += error * (5 / 16);

		const belowBackX = x - direction;

		if (belowBackX >= 0 && belowBackX < gridW) {
			values[belowIndex - direction] += error * (3 / 16);
		}

		const belowForwardX = x + direction;

		if (belowForwardX >= 0 && belowForwardX < gridW) {
			values[belowIndex + direction] += error * (1 / 16);
		}
	};

	const quantiseChannel = (values, index, x, y, direction, threshold) => {
		const oldValue = values[index];
		const newValue = oldValue < threshold ? 0 : 255;

		values[index] = newValue;

		diffuse(values, index, oldValue - newValue, x, y, direction);
	};

	for (let y = 0; y < gridH; y++) {
		const direction = y % 2 === 0 ? 1 : -1;
		const startX = direction === 1 ? 0 : gridW - 1;
		const endX = direction === 1 ? gridW : -1;

		for (let x = startX; x !== endX; x += direction) {
			const index = y * gridW + x;

			// One threshold variation per block keeps RGB channels related.
			const thresholdOffset = (random() - 0.5) * randomness;
			const threshold = 128 + thresholdOffset;

			quantiseChannel(rVals, index, x, y, direction, threshold);

			quantiseChannel(gVals, index, x, y, direction, threshold);

			quantiseChannel(bVals, index, x, y, direction, threshold);
		}
	}

	for (let gy = 0; gy < gridH; gy++) {
		for (let gx = 0; gx < gridW; gx++) {
			const index = gy * gridW + gx;

			const rOut = Math.max(0, Math.min(255, Math.round(rVals[index])));

			const gOut = Math.max(0, Math.min(255, Math.round(gVals[index])));

			const bOut = Math.max(0, Math.min(255, Math.round(bVals[index])));

			const aOut = aVals[index];

			const startX = gx * pixelSize;
			const startY = gy * pixelSize;
			const endX = Math.min(startX + pixelSize, width);
			const endY = Math.min(startY + pixelSize, height);

			for (let y = startY; y < endY; y++) {
				for (let x = startX; x < endX; x++) {
					const pixelIndex = (y * width + x) * 4;

					data[pixelIndex] = rOut;
					data[pixelIndex + 1] = gOut;
					data[pixelIndex + 2] = bOut;
					data[pixelIndex + 3] = aOut;
				}
			}
		}
	}

	context.putImageData(imageData, 0, 0);

	return seed;
}

function dither(options = {}) {
	return applyDitherToCanvas(draw_ctx, draw_canvas, options, true);
}

function hasActiveAnimationFilters() {
	return animated_glitch_on || animated_vhs_on || animated_dither_on || animated_wave_on;
}

function applyWaveToCanvas(context, canvas, vertical_offset = wave_vertical_offset, advance_wave = true) {
	const width = canvas.width;
	const height = canvas.height;
	const source = context.getImageData(0, 0, width, height);
	const shifted = context.createImageData(width, height);
	const amplitude = Math.min(width, Math.max(0, wave_amplitude));
	const frequency = Math.max(0, wave_frequency);

	for (let y = 0; y < height; y++) {
		const wave_position = ((y - vertical_offset) / height) * Math.PI * 2 * frequency;
		const line_shift = Math.round(Math.sin(wave_position) * amplitude);
		const source_x = Math.max(0, -line_shift);
		const destination_x = Math.max(0, line_shift);
		const copy_width = width - Math.abs(line_shift);

		if (copy_width <= 0) {
			continue;
		}

		const source_start = (y * width + source_x) * 4;
		const source_end = source_start + copy_width * 4;
		const destination_start = (y * width + destination_x) * 4;
		shifted.data.set(source.data.subarray(source_start, source_end), destination_start);
	}

	context.putImageData(shifted, 0, 0);
	if (advance_wave) {
		wave_vertical_offset += wave_vertical_speed;
	}
}

function renderAnimationFrameToCanvas(context, canvas, options = {}) {
	context.clearRect(0, 0, canvas.width, canvas.height);

	if (!hasActiveAnimationFilters() || !animation_base_canvas) {
		return false;
	}

	context.drawImage(animation_base_canvas, 0, 0);

	// Keep one deterministic stack order for both the live canvas and GIF export.
	if (animated_glitch_on) {
		applyGlitchToCanvas(context, canvas, false);
	}

	if (animated_vhs_on) {
		applyVhsToCanvas(context, canvas, false);
	}

	if (animated_dither_on) {
		applyDitherToCanvas(context, canvas, { seed: Math.floor(Math.random() * 0xffffffff) }, false);
	}

	if (animated_wave_on) {
		const is_gif_export_frame = Number.isFinite(options.animation_progress);
		const wave_cycle_distance = wave_frequency > 0 ? canvas.height / wave_frequency : 0;
		const export_offset = wave_vertical_offset + wave_cycle_distance * (options.animation_progress || 0);
		applyWaveToCanvas(context, canvas, is_gif_export_frame ? export_offset : wave_vertical_offset, !is_gif_export_frame);
	}

	return true;
}

function getAnimationGifFrameCount() {
	if (!animated_wave_on || wave_frequency <= 0) {
		return 10;
	}

	const wave_cycle_distance = draw_canvas.height / wave_frequency;
	return Math.min(120, Math.max(2, Math.round(wave_cycle_distance / wave_vertical_speed)));
}

function renderLiveAnimationFrame() {
	renderAnimationFrameToCanvas(draw_ctx, draw_canvas);
}

function animationTick(timestamp) {
	if (!hasActiveAnimationFilters()) {
		animation_frame = null;
		return;
	}

	if (timestamp - animation_last_update_time >= animation_speed) {
		animation_last_update_time = timestamp;
		renderLiveAnimationFrame();
	}

	animation_frame = requestAnimationFrame(animationTick);
}

function toggleAnimationFilter(filter_name) {
	const was_active = hasActiveAnimationFilters();

	if (!was_active) {
		clearFilters();
		animation_base_canvas = document.createElement("canvas");
		animation_base_canvas.width = draw_canvas.width;
		animation_base_canvas.height = draw_canvas.height;
		animation_base_canvas.getContext("2d").drawImage(draw_canvas, 0, 0);
	}

	if (filter_name === "glitch") animated_glitch_on = !animated_glitch_on;
	if (filter_name === "vhs") animated_vhs_on = !animated_vhs_on;
	if (filter_name === "dither") animated_dither_on = !animated_dither_on;
	if (filter_name === "wave") {
		animated_wave_on = !animated_wave_on;
		if (animated_wave_on) wave_vertical_offset = 0;
	}

	if (!hasActiveAnimationFilters()) {
		window.pepepaint.canvas_animation_on = false;
		if (animation_frame !== null) {
			cancelAnimationFrame(animation_frame);
			animation_frame = null;
		}
		draw_ctx.clearRect(0, 0, draw_canvas.width, draw_canvas.height);
		draw_ctx.drawImage(animation_base_canvas, 0, 0);
		animation_base_canvas = null;
		return;
	}

	window.pepepaint.canvas_animation_on = true;
	renderLiveAnimationFrame();

	if (animation_frame === null) {
		animation_last_update_time = performance.now();
		animation_frame = requestAnimationFrame(animationTick);
	}
}

function animatedDither() {
	toggleAnimationFilter("dither");
}

function animatedWave() {
	toggleAnimationFilter("wave");
}

function ditherOld() {
	saveCanvasState();

	const width = draw_canvas.width;
	const height = draw_canvas.height;
	const imageData = draw_ctx.getImageData(0, 0, width, height);
	const data = imageData.data;
	const pixelSize = Math.max(1, dither_pixel_size | 0);

	const getBlockAverage = (startX, startY) => {
		const endX = Math.min(startX + pixelSize, width);
		const endY = Math.min(startY + pixelSize, height);
		let r = 0,
			g = 0,
			b = 0,
			a = 0,
			count = 0;
		for (let y = startY; y < endY; y++) {
			for (let x = startX; x < endX; x++) {
				const idx = (y * width + x) * 4;
				r += data[idx];
				g += data[idx + 1];
				b += data[idx + 2];
				a += data[idx + 3];
				count++;
			}
		}
		if (count === 0) return [0, 0, 0, 0];
		return [r / count, g / count, b / count, a / count];
	};

	const gridW = Math.ceil(width / pixelSize);
	const gridH = Math.ceil(height / pixelSize);
	const rVals = new Float32Array(gridW * gridH);
	const gVals = new Float32Array(gridW * gridH);
	const bVals = new Float32Array(gridW * gridH);
	const aVals = new Uint8ClampedArray(gridW * gridH);

	for (let gy = 0; gy < gridH; gy++) {
		for (let gx = 0; gx < gridW; gx++) {
			const [r, g, b, a] = getBlockAverage(gx * pixelSize, gy * pixelSize);
			const idx = gy * gridW + gx;

			rVals[idx] = r;
			gVals[idx] = g;
			bVals[idx] = b;
			aVals[idx] = Math.round(a);
		}
	}

	const diffuse = (arr, idx, err, x, y) => {
		if (x + 1 < gridW) arr[idx + 1] += (err * 7) / 16;
		if (y + 1 < gridH) {
			if (x > 0) arr[idx + gridW - 1] += (err * 3) / 16;
			arr[idx + gridW] += (err * 5) / 16;
			if (x + 1 < gridW) arr[idx + gridW + 1] += (err * 1) / 16;
		}
	};

	for (let y = 0; y < gridH; y++) {
		for (let x = 0; x < gridW; x++) {
			const idx = y * gridW + x;

			const oldR = rVals[idx];
			const newR = oldR < 128 ? 0 : 255;
			rVals[idx] = newR;
			diffuse(rVals, idx, oldR - newR, x, y);

			const oldG = gVals[idx];
			const newG = oldG < 128 ? 0 : 255;
			gVals[idx] = newG;
			diffuse(gVals, idx, oldG - newG, x, y);

			const oldB = bVals[idx];
			const newB = oldB < 128 ? 0 : 255;
			bVals[idx] = newB;
			diffuse(bVals, idx, oldB - newB, x, y);
		}
	}

	for (let gy = 0; gy < gridH; gy++) {
		for (let gx = 0; gx < gridW; gx++) {
			const idx = gy * gridW + gx;
			let rOut = Math.max(0, Math.min(255, Math.round(rVals[idx])));
			let gOut = Math.max(0, Math.min(255, Math.round(gVals[idx])));
			let bOut = Math.max(0, Math.min(255, Math.round(bVals[idx])));

			const aOut = aVals[idx];
			const startX = gx * pixelSize;
			const startY = gy * pixelSize;
			const endX = Math.min(startX + pixelSize, width);
			const endY = Math.min(startY + pixelSize, height);

			for (let y = startY; y < endY; y++) {
				for (let x = startX; x < endX; x++) {
					const p = (y * width + x) * 4;
					data[p] = rOut;
					data[p + 1] = gOut;
					data[p + 2] = bOut;
					data[p + 3] = aOut;
				}
			}
		}
	}

	draw_ctx.putImageData(imageData, 0, 0);
}

function dilate() {
	saveCanvasState();

	const width = draw_canvas.width;
	const height = draw_canvas.height;
	const imageData = draw_ctx.getImageData(0, 0, width, height);
	const data = imageData.data;
	const copyData = new Uint8ClampedArray(data);

	for (let y = 1; y < height - 1; y++) {
		for (let x = 1; x < width - 1; x++) {
			const index = (y * width + x) * 4;

			for (let i = -1; i <= 1; i++) {
				for (let j = -1; j <= 1; j++) {
					const neighborIndex = ((y + i) * width + (x + j)) * 4;
					if (copyData[neighborIndex] > data[index]) {
						data[index] = copyData[neighborIndex]; // Red
						data[index + 1] = copyData[neighborIndex + 1]; // Green
						data[index + 2] = copyData[neighborIndex + 2]; // Blue
					}
				}
			}
		}
	}

	draw_ctx.putImageData(imageData, 0, 0);
}

function erode() {
	saveCanvasState();

	const width = draw_canvas.width;
	const height = draw_canvas.height;
	const imageData = draw_ctx.getImageData(0, 0, width, height);
	const data = imageData.data;
	const copyData = new Uint8ClampedArray(data);

	for (let y = 1; y < height - 1; y++) {
		for (let x = 1; x < width - 1; x++) {
			const index = (y * width + x) * 4;

			for (let i = -1; i <= 1; i++) {
				for (let j = -1; j <= 1; j++) {
					const neighborIndex = ((y + i) * width + (x + j)) * 4;
					if (copyData[neighborIndex] < data[index]) {
						data[index] = copyData[neighborIndex]; // Red
						data[index + 1] = copyData[neighborIndex + 1]; // Green
						data[index + 2] = copyData[neighborIndex + 2]; // Blue
					}
				}
			}
		}
	}

	draw_ctx.putImageData(imageData, 0, 0);
}

function solarize() {
	saveCanvasState();

	const imageData = draw_ctx.getImageData(0, 0, draw_canvas.width, draw_canvas.height);
	const data = imageData.data;

	for (let i = 0; i < data.length; i += 4) {
		const brightness = 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2];
		if (brightness > solarize_threshold_amount) {
			data[i] = 255 - data[i]; // Red
			data[i + 1] = 255 - data[i + 1]; // Green
			data[i + 2] = 255 - data[i + 2]; // Blue
		}
	}

	draw_ctx.putImageData(imageData, 0, 0);
}

function emboss() {
	saveCanvasState();

	const width = draw_canvas.width;
	const height = draw_canvas.height;
	const imageData = draw_ctx.getImageData(0, 0, width, height);
	const data = imageData.data;
	const copyData = new Uint8ClampedArray(data);
	const emboss_pixel_size = Math.max(1, parseInt(emboss_pixel_size_amount) || 1);

	for (let y = emboss_pixel_size; y < height; y += emboss_pixel_size) {
		for (let x = emboss_pixel_size; x < width; x += emboss_pixel_size) {
			const index = (y * width + x) * 4;
			const prevIndex = ((y - emboss_pixel_size) * width + (x - emboss_pixel_size)) * 4;

			const red = copyData[index] - copyData[prevIndex] + 128;
			const green = copyData[index + 1] - copyData[prevIndex + 1] + 128;
			const blue = copyData[index + 2] - copyData[prevIndex + 2] + 128;

			for (let dy = 0; dy < emboss_pixel_size; dy++) {
				for (let dx = 0; dx < emboss_pixel_size; dx++) {
					const pixelX = x + dx;
					const pixelY = y + dy;
					if (pixelX >= width || pixelY >= height) {
						continue;
					}

					const pixelIndex = (pixelY * width + pixelX) * 4;
					data[pixelIndex] = red;
					data[pixelIndex + 1] = green;
					data[pixelIndex + 2] = blue;
				}
			}
		}
	}

	draw_ctx.putImageData(imageData, 0, 0);
}

function edges() {
	saveCanvasState();

	const width = draw_canvas.width;
	const height = draw_canvas.height;
	const imageData = draw_ctx.getImageData(0, 0, width, height);
	const data = imageData.data;
	const copyData = new Uint8ClampedArray(data);
	const edge_pixel_size = Math.max(1, parseInt(edge_pixel_size_amount) || 1);

	const kernel = [-1, -1, -1, -1, 8, -1, -1, -1, -1];

	for (let y = 1; y < height - 1; y += edge_pixel_size) {
		for (let x = 1; x < width - 1; x += edge_pixel_size) {
			const index = (y * width + x) * 4;
			let r = 0,
				g = 0,
				b = 0;

			for (let ky = -1; ky <= 1; ky++) {
				for (let kx = -1; kx <= 1; kx++) {
					const pixelIndex = ((y + ky) * width + (x + kx)) * 4;
					const weight = kernel[(ky + 1) * 3 + (kx + 1)];

					r += copyData[pixelIndex] * weight;
					g += copyData[pixelIndex + 1] * weight;
					b += copyData[pixelIndex + 2] * weight;
				}
			}

			const red = Math.min(Math.max(r + 128, 0), 255);
			const green = Math.min(Math.max(g + 128, 0), 255);
			const blue = Math.min(Math.max(b + 128, 0), 255);

			for (let dy = 0; dy < edge_pixel_size; dy++) {
				for (let dx = 0; dx < edge_pixel_size; dx++) {
					const pixelX = x + dx;
					const pixelY = y + dy;

					if (pixelX >= width - 1 || pixelY >= height - 1) {
						continue;
					}

					const pixelIndex = (pixelY * width + pixelX) * 4;
					data[pixelIndex] = red;
					data[pixelIndex + 1] = green;
					data[pixelIndex + 2] = blue;
				}
			}
		}
	}

	draw_ctx.putImageData(imageData, 0, 0);
}

function pixelate() {
	saveCanvasState();

	const width = draw_canvas.width;
	const height = draw_canvas.height;
	const imageData = draw_ctx.getImageData(0, 0, width, height);
	const data = imageData.data;

	for (let y = 0; y < height; y += pixelate_amount) {
		for (let x = 0; x < width; x += pixelate_amount) {
			const index = (y * width + x) * 4;
			const red = data[index];
			const green = data[index + 1];
			const blue = data[index + 2];

			for (let dy = 0; dy < pixelate_amount; dy++) {
				for (let dx = 0; dx < pixelate_amount; dx++) {
					const pixelIndex = ((y + dy) * width + (x + dx)) * 4;
					data[pixelIndex] = red;
					data[pixelIndex + 1] = green;
					data[pixelIndex + 2] = blue;
				}
			}
		}
	}

	draw_ctx.putImageData(imageData, 0, 0);
}

function applyGlitchToCanvas(context, canvas, save_history = true) {
	if (save_history) {
		saveCanvasState();
	}

	const width = canvas.width;
	const height = canvas.height;
	const imageData = context.getImageData(0, 0, width, height);
	const data = imageData.data;
	const copyData = new Uint8ClampedArray(data); // Copy of the original data

	for (let y = 0; y < height; y += glitch_pixel_size) {
		for (let x = 0; x < width; x += glitch_pixel_size) {
			// Choose a random shift for the whole block
			const shiftX = Math.round((Math.random() - 0.5) * glitch_amount);
			const shiftY = Math.round((Math.random() - 0.5) * glitch_amount);

			for (let dy = 0; dy < glitch_pixel_size; dy++) {
				for (let dx = 0; dx < glitch_pixel_size; dx++) {
					const px = x + dx;
					const py = y + dy;

					// Skip out-of-bounds pixels
					if (px >= width || py >= height) continue;

					const srcX = Math.min(Math.max(px + shiftX, 0), width - 1);
					const srcY = Math.min(Math.max(py + shiftY, 0), height - 1);

					const index = (py * width + px) * 4;
					const srcIndex = (srcY * width + srcX) * 4;

					data[index] = copyData[srcIndex]; // Red
					data[index + 1] = copyData[srcIndex + 1]; // Green
					data[index + 2] = copyData[srcIndex + 2]; // Blue
					// Alpha remains unchanged
				}
			}
		}
	}

	context.putImageData(imageData, 0, 0);
}

function glitch() {
	applyGlitchToCanvas(draw_ctx, draw_canvas, true);
}

function animatedGlitch() {
	toggleAnimationFilter("glitch");
}

function applyVhsToCanvas(context, canvas, save_history = true) {
	if (save_history) {
		saveCanvasState();
	}

	const width = draw_canvas.width;
	const height = draw_canvas.height;
	const imageData = draw_ctx.getImageData(0, 0, width, height);
	const data = imageData.data;

	// Create scan lines and distortions
	for (let y = 0; y < height; y++) {
		const lineOffset = Math.sin(y / 20) * 5; // Wavy distortion factor

		for (let x = 0; x < width; x++) {
			const index = (y * width + x) * 4;

			// Apply scan lines
			if (y % 2 === 0) {
				data[index] *= 0.9; // Darken red
				data[index + 1] *= 0.9; // Darken green
				data[index + 2] *= 0.9; // Darken blue
			}

			// Slightly shift color channels for chromatic aberration
			// if (x + lineOffset > 0 && x + lineOffset < width) {
			//     const shiftedIndex = (y * width + Math.floor(x + lineOffset)) * 4;
			//     data[index] = data[shiftedIndex];       // Red channel shift
			//     data[index + 1] = data[shiftedIndex + 1]; // Green channel shift
			// }

			// Add noise
			const noise = (Math.random() - 0.5) * 50; // Random noise
			data[index] += noise; // Red
			data[index + 1] += noise; // Green
			data[index + 2] += noise; // Blue
		}
	}

	// Desaturate slightly
	for (let i = 0; i < data.length; i += 4) {
		const gray = 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2];
		data[i] = data[i] * 0.9 + gray * 0.1; // Blend red
		data[i + 1] = data[i + 1] * 0.9 + gray * 0.1; // Blend green
		data[i + 2] = data[i + 2] * 0.9 + gray * 0.1; // Blend blue
	}

	// Apply the modified image data back to the canvas
	draw_ctx.putImageData(imageData, 0, 0);

	// Optional: Draw additional effects like a border or glitch lines
	drawGlitchLines(draw_ctx, width, height);
}

function vhs() {
	applyVhsToCanvas(draw_ctx, draw_canvas, true);
}

function animatedVhs() {
	toggleAnimationFilter("vhs");
}
// For VHS effect
function drawGlitchLines(ctx, width, height) {
	ctx.save();
	ctx.globalAlpha = 0.1;

	for (let i = 0; i < 5; i++) {
		const y = Math.random() * height;
		const thickness = Math.random() * 3 + 1;

		ctx.fillStyle = `rgba(255, 255, 255, ${Math.random() * 0.2})`;
		ctx.fillRect(0, y, width, thickness);
	}

	ctx.restore();
}

window.pepepaint.renderAnimationFrameToCanvas = renderAnimationFrameToCanvas;
window.pepepaint.getAnimationGifFrameCount = getAnimationGifFrameCount;

// Vignette Effect (Dark edges like an old screen)
function vignette() {
	saveCanvasState();

	const width = window_w;
	const height = window_h;

	const gradient = draw_canvas.getContext("2d").createRadialGradient(width / 2, height / 2, width / 4, width / 2, height / 2, width / 1.2);
	gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
	gradient.addColorStop(1, "rgba(0, 0, 0, 0.5)");

	draw_canvas.getContext("2d").fillStyle = gradient;
	draw_canvas.getContext("2d").fillRect(0, 0, width, height);
}

// Barrel Distortion (Slight curvature like a convex CRT screen)
function barrel() {
	saveCanvasState();

	const width = window_w;
	const height = window_h;

	const tempCanvas = document.createElement("canvas");
	const tempCtx = tempCanvas.getContext("2d");
	tempCanvas.width = width;
	tempCanvas.height = height;

	tempCtx.imageSmoothingEnabled = true;
	draw_canvas.imageSmoothingEnabled = true;

	tempCtx.drawImage(draw_canvas, 0, 0, width, height);

	draw_ctx.clearRect(0, 0, width, height);

	// Apply distortion by redrawing pixels slightly curved
	draw_ctx.drawImage(tempCanvas, -5, -5, width + 10, height + 10);
}

function crt2() {
	saveCanvasState();

	const width = draw_canvas.width;
	const height = draw_canvas.height;

	// Get the canvas pixel data
	const imageData = draw_ctx.getImageData(0, 0, width, height);
	const data = imageData.data;
	const copyData = new Uint8ClampedArray(data);

	const bandSize = Math.max(1, parseInt(crt_pixel_size_amount) || 1);
	const triadWidth = bandSize * 3;
	const blockHeight = bandSize;

	for (let y = 0; y < height; y += blockHeight) {
		for (let x = 0; x < width; x += triadWidth) {
			let totalR = 0,
				totalG = 0,
				totalB = 0,
				count = 0;

			// Calculate average color across one full triad block.
			for (let dy = 0; dy < blockHeight; dy++) {
				for (let dx = 0; dx < triadWidth; dx++) {
					const px = x + dx;
					const py = y + dy;
					if (px < width && py < height) {
						const index = (py * width + px) * 4;
						totalR += copyData[index];
						totalG += copyData[index + 1];
						totalB += copyData[index + 2];
						count++;
					}
				}
			}

			if (count === 0) {
				continue;
			}

			const avgR = totalR / count;
			const avgG = totalG / count;
			const avgB = totalB / count;

			// Apply separated RGB bands where each band is `bandSize` pixels wide.
			for (let dy = 0; dy < blockHeight; dy++) {
				for (let dx = 0; dx < triadWidth; dx++) {
					const px = x + dx;
					const py = y + dy;
					if (px < width && py < height) {
						const index = (py * width + px) * 4;

						if (dx < bandSize) {
							// Red band
							data[index] = avgR;
							data[index + 1] = 0;
							data[index + 2] = 0;
						} else if (dx < bandSize * 2) {
							// Green band
							data[index] = 0;
							data[index + 1] = avgG;
							data[index + 2] = 0;
						} else {
							// Blue band
							data[index] = 0;
							data[index + 1] = 0;
							data[index + 2] = avgB;
						}
					}
				}
			}
		}
	}

	draw_ctx.putImageData(imageData, 0, 0);
}

Object.assign(window, {
	animatedDither,
	animatedGlitch,
	animatedVhs,
	animatedWave,
	barrel,
	blurr,
	crt2,
	dilate,
	dither,
	edges,
	emboss,
	erode,
	glitch,
	invert,
	monochrome,
	pixelate,
	posterize,
	sepia,
	solarize,
	threshold,
	vhs,
	vignette,
});
