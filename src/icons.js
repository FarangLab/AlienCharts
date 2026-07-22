// Icons downloaded from https://phosphoricons.com/
const icons = {
  arrowLineRight: '<line x1="32" y1="128" x2="176" y2="128"/><polyline points="104 56 176 128 104 200"/><line x1="216" y1="40" x2="216" y2="216"/>',
  pushPinSimple: '<path d="M224,176a8,8,0,0,1-8,8H136v56a8,8,0,0,1-16,0V184H40a8,8,0,0,1,0-16h9.29L70.46,48H64a8,8,0,0,1,0-16H192a8,8,0,0,1,0,16h-6.46l21.17,120H216A8,8,0,0,1,224,176Z"/>',
  arrowCounterClockwise: '<polyline points="24 56 24 104 72 104"/><path d="M67.59,192A88,88,0,1,0,65.77,65.77L24,104"/>',
  arrowsIn: '<polyline points="192 104 152 104 152 64"/><line x1="208" y1="48" x2="152" y2="104"/><polyline points="64 152 104 152 104 192"/><line x1="48" y1="208" x2="104" y2="152"/><polyline points="152 192 152 152 192 152"/><line x1="208" y1="208" x2="152" y2="152"/><polyline points="104 64 104 104 64 104"/><line x1="48" y1="48" x2="104" y2="104"/>',
  arrowsOut: '<polyline points="160 48 208 48 208 96"/><line x1="152" y1="104" x2="208" y2="48"/><polyline points="96 208 48 208 48 160"/><line x1="104" y1="152" x2="48" y2="208"/><polyline points="208 160 208 208 160 208"/><line x1="152" y1="152" x2="208" y2="208"/><polyline points="48 96 48 48 96 48"/><line x1="104" y1="104" x2="48" y2="48"/>',
  broom: '<path d="M112,224a95.2,95.2,0,0,1-29-48"/><path d="M192,152c0,31.67,13.31,59,40,72H61A103.65,103.65,0,0,1,32,152c0-28.21,11.23-50.89,29.47-69.64a8,8,0,0,1,8.67-1.81L95.52,90.83a16,16,0,0,0,20.82-9l21-53.11c4.15-10,15.47-15.32,25.63-11.53a20,20,0,0,1,11.51,26.4L153.13,96.69a16,16,0,0,0,8.93,20.76L187,127.29a8,8,0,0,1,5,7.43Z"/><line x1="40.54" y1="112.21" x2="194.26" y2="173.7"/>',
  waveSine: '<path d="M24,128c104-221.7,104,221.7,208,0"/>',
  magnifyingGlassPlus: '<line x1="80" y1="112" x2="144" y2="112"/><circle cx="112" cy="112" r="80"/><line x1="168.57" y1="168.57" x2="224" y2="224"/><line x1="112" y1="80" x2="112" y2="144"/>',
  mapPin: '<circle cx="128" cy="104" r="32"/><path d="M208,104c0,72-80,128-80,128S48,176,48,104a80,80,0,0,1,160,0Z"/>',
  minus: '<line x1="40" y1="128" x2="216" y2="128"/>',
  eye: '<path d="M128,56C48,56,16,128,16,128s32,72,112,72,112-72,112-72S208,56,128,56Z"/><circle cx="128" cy="128" r="32"/>',
};

const filledIcons = new Set(["pushPinSimple"]);

export const iconSvg = (name, { size = 16, className = "" } = {}) => {
  const body = icons[name];
  if (!body) throw new Error(`Unknown AlienCharts icon: ${name}`);
  const paint = filledIcons.has(name)
    ? 'fill="currentColor"'
    : 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="24"';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="${size}" height="${size}" class="${className}" aria-hidden="true" ${paint}>${body}</svg>`;
};

export const createIconElement = (documentRef, name, options) => {
  const template = documentRef.createElement("template");
  template.innerHTML = iconSvg(name, options).trim();
  return template.content.firstElementChild;
};
