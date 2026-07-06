import { useEffect, useState, useCallback } from "react";

/**
 * Resolve a CSS custom property against the document root, with a fallback.
 */
function resolveCssToken(token: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return value || fallback;
}

/**
 * Copy computed presentation styles onto a cloned SVG tree so that CSS
 * variables (var(--accent) etc.) resolve to concrete values before the SVG is
 * serialized for export. Serialized SVG strings have no access to the page
 * stylesheet, so unresolved var() references would render as black/transparent.
 */
const EXPORT_STYLE_PROPS = [
  "fill",
  "stroke",
  "stroke-width",
  "stop-color",
  "stop-opacity",
  "color",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "text-anchor"
] as const;

function inlineComputedStyles(source: SVGSVGElement, clone: SVGSVGElement) {
  const sourceElements = [source, ...Array.from(source.querySelectorAll<SVGElement>("*"))];
  const cloneElements = [clone, ...Array.from(clone.querySelectorAll<SVGElement>("*"))];

  sourceElements.forEach((element, index) => {
    const target = cloneElements[index];
    if (!target) return;
    const computed = window.getComputedStyle(element);
    for (const prop of EXPORT_STYLE_PROPS) {
      const value = computed.getPropertyValue(prop);
      if (value) {
        target.style.setProperty(prop, value);
      }
    }
  });
}

/**
 * Hook for PNG export of chart elements
 */
export function useChartExport() {
  const exportToPNG = useCallback(async (
    svgElement: SVGSVGElement,
    filename: string,
    options?: { scale?: number; backgroundColor?: string }
  ) => {
    const scale = options?.scale ?? 2;
    // Resolve the export background from the design tokens rather than a hardcoded hex.
    const backgroundColor = options?.backgroundColor ?? resolveCssToken("--bg-primary", "#08111f");

    // Get SVG dimensions
    const rect = svgElement.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width * scale));
    const height = Math.max(1, Math.round(rect.height * scale));

    // Clone and inline computed styles so CSS variables resolve in the export.
    const clone = svgElement.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("width", String(rect.width));
    clone.setAttribute("height", String(rect.height));
    inlineComputedStyles(svgElement, clone);

    // Serialize SVG
    const svgData = new XMLSerializer().serializeToString(clone);
    const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    try {
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
          resolve();
        };
        img.onerror = () => reject(new Error("Failed to rasterize chart SVG"));
        img.src = url;
      });

      // Download
      const pngUrl = canvas.toDataURL("image/png");
      const link = document.createElement("a");
      link.download = filename;
      link.href = pngUrl;
      link.click();
    } finally {
      URL.revokeObjectURL(url);
    }
  }, []);

  return { exportToPNG };
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
