const INITIAL_GPU_VERTEX_CAPACITY = 4096;

export const createProgram = (gl, vertexSource, fragmentSource) => {
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) || "Shader compile failed");
    }
    return shader;
  };

  const program = gl.createProgram();
  const vertexShader = compile(gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compile(gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || "Program link failed");
  }
  return program;
};

export const hexToRgb = (color) => {
  const value = String(color || "#38bdf8").replace("#", "");
  const normalized =
    value.length === 3
      ? value.split("").map((char) => char + char).join("")
      : value.padEnd(6, "0").slice(0, 6);
  const number = Number.parseInt(normalized, 16);
  return [
    ((number >> 16) & 255) / 255,
    ((number >> 8) & 255) / 255,
    (number & 255) / 255,
  ];
};

const getNextVertexCapacity = (currentCapacity, requiredCapacity) => {
  let nextCapacity = Math.max(
    INITIAL_GPU_VERTEX_CAPACITY,
    currentCapacity || 0,
  );
  while (nextCapacity < requiredCapacity) nextCapacity *= 2;
  return nextCapacity;
};

export const getDynamicBuffer = (gl, cache, key, requiredFloats) => {
  let entry = cache.get(key);
  if (!entry) {
    entry = {
      buffer: gl.createBuffer(),
      gpuCapacity: 0,
      vertices: new Float32Array(
        getNextVertexCapacity(0, requiredFloats),
      ),
    };
    cache.set(key, entry);
  }
  if (entry.vertices.length < requiredFloats) {
    entry.vertices = new Float32Array(
      getNextVertexCapacity(entry.vertices.length, requiredFloats),
    );
  }
  if (entry.gpuCapacity < entry.vertices.length) {
    entry.gpuCapacity = entry.vertices.length;
    gl.bindBuffer(gl.ARRAY_BUFFER, entry.buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      entry.gpuCapacity * Float32Array.BYTES_PER_ELEMENT,
      gl.DYNAMIC_DRAW,
    );
  }
  return entry;
};

export const deleteBufferCache = (gl, cache) => {
  cache.forEach((entry) => {
    if (entry.buffer) gl.deleteBuffer(entry.buffer);
  });
  cache.clear();
};
