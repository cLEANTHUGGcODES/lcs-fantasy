import type { ComponentProps } from "react";
import Image from "next/image";

type CroppedTeamLogoProps = {
  alt: string;
  src: string;
  frameClassName?: string;
  imageClassName?: string;
  width: number;
  height: number;
  onError?: ComponentProps<typeof Image>["onError"];
};

export const CroppedTeamLogo = ({
  alt,
  src,
  frameClassName,
  imageClassName,
  width,
  height,
  onError,
}: CroppedTeamLogoProps) => (
  <span
    className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden ${
      frameClassName ?? ""
    }`}
  >
    <Image
      alt={alt}
      className={`absolute left-1/2 top-1/2 w-auto max-w-none -translate-x-1/2 -translate-y-1/2 object-contain ${
        imageClassName ?? ""
      }`}
      height={height}
      src={src}
      width={width}
      onError={onError}
    />
  </span>
);
