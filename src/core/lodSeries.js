const DEFAULT_MAX_LEVELS = 18;

const toTypedArray = (value, Type) => {
  if (value instanceof Type) return value;
  if (ArrayBuffer.isView(value)) return new Type(value);
  if (Array.isArray(value)) return new Type(value);
  return new Type(0);
};

const lowerBound = (array, value) => {
  let lo = 0;
  let hi = array.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (array[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

const upperBound = (array, value) => {
  let lo = 0;
  let hi = array.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (array[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

const pushUniqueSorted = (indices, index) => {
  if (index < 0) return;
  if (indices.includes(index)) return;
  indices.push(index);
};

const buildLod = (rawX, rawY, bucketSize, startIndex = 0, endIndex = rawX.length) => {
  if (bucketSize <= 1 || rawX.length <= bucketSize) {
    return { x: rawX, y: rawY, bucketSize: 1 };
  }

  const alignedStart = Math.max(0, Math.floor(startIndex / bucketSize) * bucketSize);
  const alignedEnd = Math.min(rawX.length, endIndex);
  const estimated = Math.ceil((alignedEnd - alignedStart) / bucketSize) * 4;
  const x = new Float64Array(estimated);
  const y = new Float32Array(estimated);
  let out = 0;

  for (let start = alignedStart; start < alignedEnd; start += bucketSize) {
    const end = Math.min(alignedEnd, start + bucketSize);
    let minIndex = start;
    let maxIndex = start;
    for (let i = start + 1; i < end; i += 1) {
      if (rawY[i] < rawY[minIndex]) minIndex = i;
      if (rawY[i] > rawY[maxIndex]) maxIndex = i;
    }

    const indices = [];
    pushUniqueSorted(indices, start);
    pushUniqueSorted(indices, minIndex);
    pushUniqueSorted(indices, maxIndex);
    pushUniqueSorted(indices, end - 1);
    indices.sort((a, b) => a - b);

    for (let i = 0; i < indices.length; i += 1) {
      const sourceIndex = indices[i];
      x[out] = rawX[sourceIndex];
      y[out] = rawY[sourceIndex];
      out += 1;
    }
  }

  return {
    x: x.subarray(0, out),
    y: y.subarray(0, out),
    bucketSize,
  };
};

const concatTyped = (Type, left, right) => {
  if (!left?.length) return right;
  if (!right?.length) return left;
  const out = new Type(left.length + right.length);
  out.set(left, 0);
  out.set(right, left.length);
  return out;
};

class LodSeries {
  constructor({ id, name, color, x, y, maxLevels = DEFAULT_MAX_LEVELS }) {
    this.id = id;
    this.name = name || id;
    this.color = color || "#38bdf8";
    this.maxLevels = maxLevels;
    const initialX = toTypedArray(x, Float64Array);
    const initialY = toTypedArray(y, Float32Array);
    this._length = Math.min(initialX.length, initialY.length);
    const capacity = Math.max(1, this._length);
    this.rawX = new Float64Array(capacity);
    this.rawY = new Float32Array(capacity);
    this.rawX.set(initialX.subarray(0, this._length));
    this.rawY.set(initialY.subarray(0, this._length));
    this.levels = [];
    this.rebuildLevels();
  }

  get length() {
    return this._length;
  }

  append(xValues, yValues) {
    const nextX = toTypedArray(xValues, Float64Array);
    const nextY = toTypedArray(yValues, Float32Array);
    const appendLength = Math.min(nextX.length, nextY.length);
    if (appendLength === 0) return;

    const currentLength = this.length;
    this.ensureRawCapacity(currentLength + appendLength);
    this.rawX.set(nextX.subarray(0, appendLength), currentLength);
    this.rawY.set(nextY.subarray(0, appendLength), currentLength);
    this._length = currentLength + appendLength;
    this.markLevelsDirty(currentLength);
  }

  rebuildLevels() {
    const rawX = this.rawX.subarray(0, this.length);
    const rawY = this.rawY.subarray(0, this.length);
    this.levels = [{ x: rawX, y: rawY, bucketSize: 1 }];

    let bucketSize = 4;
    while (
      this.levels.length < this.maxLevels &&
      bucketSize < Math.max(8, rawX.length)
    ) {
      this.levels.push(buildLod(rawX, rawY, bucketSize));
      bucketSize *= 4;
    }
  }

  ensureRawCapacity(requiredLength) {
    if (requiredLength <= this.rawX.length && requiredLength <= this.rawY.length) {
      return;
    }
    const nextCapacity = Math.max(requiredLength, Math.ceil(this.rawX.length * 1.5));
    const rawX = new Float64Array(nextCapacity);
    const rawY = new Float32Array(nextCapacity);
    rawX.set(this.rawX.subarray(0, this.length));
    rawY.set(this.rawY.subarray(0, this.length));
    this.rawX = rawX;
    this.rawY = rawY;
  }

  markLevelsDirty(previousLength) {
    const rawX = this.rawX.subarray(0, this.length);
    const rawY = this.rawY.subarray(0, this.length);
    this.levels[0] = { x: rawX, y: rawY, bucketSize: 1 };

    let bucketSize =
      this.levels.length > 0
        ? this.levels[this.levels.length - 1].bucketSize * 4
        : 4;
    while (
      this.levels.length < this.maxLevels &&
      bucketSize < Math.max(8, rawX.length)
    ) {
      this.levels.push(buildLod(rawX, rawY, bucketSize));
      bucketSize *= 4;
    }

    for (let i = 1; i < this.levels.length; i += 1) {
      const level = this.levels[i];
      const dirtyRawStart =
        Math.floor(previousLength / level.bucketSize) * level.bucketSize;
      level.dirtyFrom = Math.min(level.dirtyFrom ?? dirtyRawStart, dirtyRawStart);
    }
  }

  ensureLevel(index) {
    const level = this.levels[index];
    if (!level || index === 0 || level.dirtyFrom == null) return level;

    const rawX = this.rawX.subarray(0, this.length);
    const rawY = this.rawY.subarray(0, this.length);
    const dirtyRawStart =
      Math.floor(level.dirtyFrom / level.bucketSize) * level.bucketSize;
    const cutoffX = rawX[dirtyRawStart] ?? rawX[0] ?? 0;
    const keepCount = lowerBound(level.x, cutoffX);
    const tail = buildLod(rawX, rawY, level.bucketSize, dirtyRawStart, rawX.length);
    this.levels[index] = {
      x: concatTyped(Float64Array, level.x.subarray(0, keepCount), tail.x),
      y: concatTyped(Float32Array, level.y.subarray(0, keepCount), tail.y),
      bucketSize: level.bucketSize,
    };
    return this.levels[index];
  }

  selectLevel(xMin, xMax, pixelWidth, targetPointsPerPixel = 2.5) {
    const rawX = this.levels[0].x;
    if (rawX.length === 0) return this.levels[0];

    const from = lowerBound(rawX, xMin);
    const to = upperBound(rawX, xMax);
    const visibleRawPoints = Math.max(0, to - from);
    const targetPoints = Math.max(32, pixelWidth * targetPointsPerPixel);
    const desiredBucket = Math.max(1, visibleRawPoints / targetPoints);

    let selectedIndex = 0;
    for (let i = 1; i < this.levels.length; i += 1) {
      if (this.levels[i].bucketSize <= desiredBucket) {
        selectedIndex = i;
      } else {
        break;
      }
    }
    return this.ensureLevel(selectedIndex);
  }

  getVisiblePoints(xMin, xMax, pixelWidth) {
    const level = this.selectLevel(xMin, xMax, pixelWidth);
    const start = Math.max(0, lowerBound(level.x, xMin) - 1);
    const end = Math.min(level.x.length, upperBound(level.x, xMax) + 1);
    return {
      x: level.x.subarray(start, end),
      y: level.y.subarray(start, end),
      bucketSize: level.bucketSize,
      pointCount: Math.max(0, end - start),
    };
  }
}

export class LineSeries extends LodSeries {
  constructor(options) {
    super(options);
    this.type = "line";
  }
}

export class BarSeries extends LodSeries {
  constructor({ orientation = "vertical", ...options }) {
    super(options);
    if (orientation !== "vertical" && orientation !== "horizontal") {
      throw new TypeError(
        'BarSeries orientation must be "vertical" or "horizontal"',
      );
    }
    this.type = "bar";
    this.orientation = orientation;
  }
}

export const createLineSeries = (options) => new LineSeries(options);
export const createSeries = createLineSeries;
export const createBarSeries = (options) => new BarSeries(options);
