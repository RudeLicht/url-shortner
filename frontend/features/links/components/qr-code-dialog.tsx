"use client";

import { useRef, useState } from "react";
import { QRCodeCanvas, QRCodeSVG } from "qrcode.react";
import { DownloadIcon, QrCodeIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { buildShortUrl } from "@/features/links/utils";

const QR_SIZE = 200;
// A PNG download benefits from more resolution than the on-screen preview.
const QR_DOWNLOAD_SIZE = 512;
// The QR spec's quiet zone (4 modules), rendered as part of the image itself
// (via the library's `marginSize`) rather than with surrounding CSS padding.
const QR_MARGIN_MODULES = 4;
// A QR code must stay dark-on-light to stay scannable and readable in both
// themes - these are QR content, not themed UI, so they're deliberately
// literal rather than semantic tokens.
const QR_FOREGROUND = "#000000";
const QR_BACKGROUND = "#ffffff";

type QrCodeDialogProps = {
  code: string;
};

/** Shows a scannable QR code for a short link, with a PNG download. */
export function QrCodeDialog({ code }: QrCodeDialogProps) {
  const [open, setOpen] = useState(false);
  // The hidden canvas below is only mounted while the dialog is open (jsdom
  // has no canvas support, so it's kept out of the tree entirely otherwise),
  // but it's mounted unconditionally for the lifetime of the dialog - not
  // just while a download is in flight. qrcode.react draws the QR code onto
  // the canvas in its own useEffect, which runs after this ref callback (ref
  // callbacks fire before effects), so exporting eagerly on mount would
  // capture a still-blank canvas. Keeping it mounted while open means its
  // draw effect has already run by the time the user can click Download.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const shortUrl = buildShortUrl(code);

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const url = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = url;
    link.download = `${code}.png`;
    link.click();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label="Show QR code" />}
      >
        <QrCodeIcon />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>QR code</DialogTitle>
          <DialogDescription>Scan to open the short link.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3">
          {/* The quiet zone (marginSize) is rendered inside the SVG itself,
              as part of its own white background - no extra wrapper needed
              to stay readable against a dark popover in dark mode. */}
          <QRCodeSVG
            value={shortUrl}
            size={QR_SIZE}
            fgColor={QR_FOREGROUND}
            bgColor={QR_BACKGROUND}
            marginSize={QR_MARGIN_MODULES}
            title={shortUrl}
          />
          <span className="break-all text-center font-mono text-sm text-foreground">
            {shortUrl}
          </span>
        </div>
        {/* Mounted off-screen for the lifetime of the dialog, purely to
            produce the PNG on demand - the visible preview above is the SVG. */}
        <QRCodeCanvas
          ref={canvasRef}
          value={shortUrl}
          size={QR_DOWNLOAD_SIZE}
          fgColor={QR_FOREGROUND}
          bgColor={QR_BACKGROUND}
          marginSize={QR_MARGIN_MODULES}
          className="hidden"
          aria-hidden="true"
        />
        <DialogFooter>
          <Button type="button" onClick={handleDownload}>
            <DownloadIcon />
            Download PNG
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
