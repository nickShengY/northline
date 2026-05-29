import { useEffect, useRef, useState, useCallback } from "react";

interface Size {
  width: number;
  height: number;
}

/**
 * Hook to observe element size changes using ResizeObserver
 * Returns responsive dimensions for chart sizing
 */
export function useResizeObserver<T extends HTMLElement>(): [React.RefObject<T | null>, Size] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setSize({ width, height });
      }
    });

    resizeObserver.observe(element);

    // Initial size
    const { width, height } = element.getBoundingClientRect();
    setSize({ width, height });

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  return [ref, size];
}

/**
 * Hook to get responsive chart dimensions based on container size
 * @param baseWidth Default width
 * @param baseHeight Default height
 * @param aspectRatio Optional aspect ratio to maintain (width/height)
 */
export function useResponsiveChart(
  baseWidth = 300,
  baseHeight = 200,
  aspectRatio?: number
): [React.RefObject<HTMLDivElement | null>, number, number] {
  const [ref, size] = useResizeObserver<HTMLDivElement>();

  const width = Math.max(size.width || baseWidth, 100);
  const height = aspectRatio
    ? Math.round(width / aspectRatio)
    : Math.max(size.height || baseHeight, 100);

  return [ref, width, height];
}

/**
 * Hook for PNG/SVG export of chart elements
 */
export function useChartExport() {
  const exportToPNG = useCallback(async (
    svgElement: SVGSVGElement,
    filename: string,
    options?: { scale?: number; backgroundColor?: string }
  ) => {
    const scale = options?.scale ?? 2;
    const backgroundColor = options?.backgroundColor ?? "#0a1628";

    // Get SVG dimensions
    const rect = svgElement.getBoundingClientRect();
    const width = rect.width * scale;
    const height = rect.height * scale;

    // Serialize SVG
    const svgData = new XMLSerializer().serializeToString(svgElement);
    const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    // Create canvas
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas context not available");

    // Fill background
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);

    // Load SVG and draw
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => {
        ctx.drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(url);
        resolve();
      };
      img.onerror = reject;
      img.src = url;
    });

    // Download
    const pngUrl = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.download = filename;
    link.href = pngUrl;
    link.click();
  }, []);

  const exportToSVG = useCallback((svgElement: SVGSVGElement, filename: string) => {
    const svgData = new XMLSerializer().serializeToString(svgElement);
    const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    const link = document.createElement("a");
    link.download = filename;
    link.href = url;
    link.click();

    setTimeout(() => URL.revokeObjectURL(url), 100);
  }, []);

  return { exportToPNG, exportToSVG };
}

/**
 * Hook to detect if running on mobile/tablet
 */
export function useMobileDetect(): {
  isMobile: boolean;
  isTablet: boolean;
  isTouch: boolean;
} {
  const [state, setState] = useState({
    isMobile: false,
    isTablet: false,
    isTouch: false
  });

  useEffect(() => {
    const check = () => {
      const width = window.innerWidth;
      const touch = "ontouchstart" in window || navigator.maxTouchPoints > 0;

      setState({
        isMobile: width < 768,
        isTablet: width >= 768 && width < 1024,
        isTouch: touch
      });
    };

    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  return state;
}
