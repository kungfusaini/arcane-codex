type PageIconProps = {
  icon: string | null;
  iconAssetId?: string | null;
  fallback?: string;
  className?: string;
  imageVariant?: 'icon' | 'page-icon';
};

export function PageIcon({ icon, iconAssetId, fallback = '📄', className = 'page-icon-glyph', imageVariant = 'icon' }: PageIconProps) {
  if (iconAssetId) {
    const intrinsicSize = imageVariant === 'page-icon' ? 192 : 64;
    return (
      <span className={`${className} has-image`} aria-hidden="true">
        <img src={`/api/assets/${iconAssetId}?variant=${imageVariant}`} alt="" loading="lazy" decoding="async" width={intrinsicSize} height={intrinsicSize} />
      </span>
    );
  }

  return <span className={className} aria-hidden="true">{icon ?? fallback}</span>;
}
