import "@testing-library/jest-dom/vitest";

Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
	value: () =>
		({
			font: "",
			measureText: (text: string) => ({ width: text.length * 8 }),
		}) as unknown as CanvasRenderingContext2D,
});
