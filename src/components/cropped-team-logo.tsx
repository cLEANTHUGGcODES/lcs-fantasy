import type { ComponentProps } from "react";
import Image from "next/image";

type CroppedTeamLogoProps = {
  alt: string;
  src: string;
  frameClassName?: string;
  imageClassName?: string;
  width: number;
  height: number;
  lightBackdrop?: boolean;
  onError?: ComponentProps<typeof Image>["onError"];
};

const shouldUseLightBackdrop = ({
  alt,
  src,
  lightBackdrop,
}: {
  alt: string;
  src: string;
  lightBackdrop?: boolean;
}): boolean => {
  if (typeof lightBackdrop === "boolean") {
    return lightBackdrop;
  }

  const normalized = `${alt} ${src}`.toLowerCase();
  return normalized.includes("disguised");
};

export const CroppedTeamLogo = ({
  alt,
  src,
  frameClassName,
  imageClassName,
  width,
  height,
  lightBackdrop,
  onError,
}: CroppedTeamLogoProps) => {
  const useLightBackdrop = shouldUseLightBackdrop({ alt, src, lightBackdrop });

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden ${
        frameClassName ?? ""
      }`}
    >
      {useLightBackdrop ? (
        <span
          aria-hidden
          className="absolute inset-0 rounded-[3px] border border-[#d8ccb1] bg-[#f5efdf]"
        />
      ) : null}
      <Image
        alt={alt}
        className={`absolute left-1/2 top-1/2 z-[1] w-auto max-w-none -translate-x-1/2 -translate-y-1/2 object-contain ${
          imageClassName ?? ""
        }`}
        height={height}
        src={src}
        width={width}
        onError={onError}
      />
    </span>
  );
};
