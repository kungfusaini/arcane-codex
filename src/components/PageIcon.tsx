type PageIconProps = {
  icon: string | null;
  iconAssetId?: string | null;
  fallback?: string;
  className?: string;
};

export function PageIcon({ icon, iconAssetId, fallback = '📄', className = 'page-icon-glyph' }: PageIconProps) {
  if (iconAssetId) {
    return (
      <span className={`${className} has-image`} aria-hidden="true">
        <img src={`/api/assets/${iconAssetId}?variant=icon`} alt="" loading="lazy" decoding="async" width="64" height="64" />
      </span>
    );
  }

  return <span className={className} aria-hidden="true">{icon ?? fallback}</span>;
}
