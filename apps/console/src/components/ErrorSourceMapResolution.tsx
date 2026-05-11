import type { SourceMapResolution } from "../api/types";

type Props = {
  resolution?: SourceMapResolution;
  isLoading?: boolean;
};

const statusLabels: Record<SourceMapResolution["status"], string> = {
  resolved: "Resolved",
  partially_resolved: "Partially resolved",
  unresolved: "Unresolved",
  unavailable: "Unavailable"
};

export function ErrorSourceMapResolution({ resolution, isLoading }: Props) {
  if (isLoading) {
    return (
      <section className="source-map-resolution">
        <div className="source-map-resolution__header">
          <h3>Source map resolution</h3>
        </div>
        <p className="muted-text">Resolving source map frames</p>
      </section>
    );
  }

  if (!resolution) {
    return (
      <section className="source-map-resolution">
        <div className="source-map-resolution__header">
          <h3>Source map resolution</h3>
        </div>
        <p className="muted-text">Source map resolution unavailable.</p>
      </section>
    );
  }

  return (
    <section className="source-map-resolution">
      <div className="source-map-resolution__header">
        <h3>Source map resolution</h3>
        <span className={`status-pill status-pill--source-map-${resolution.status}`}>{statusLabels[resolution.status]}</span>
      </div>
      {resolution.frames.length === 0 ? <p className="muted-text">No frames resolved for this error.</p> : null}
      {resolution.frames.length > 0 ? (
        <ol className="source-map-resolution__frames">
          {resolution.frames.map((frame) => (
            <li className="source-map-resolution__frame" key={`${frame.frameIndex}-${frame.sourceMapArtifactId}`}>
              <div>
                <strong>
                  {frame.originalSource}:{frame.originalLine}:{frame.originalColumn}
                </strong>
                <span>{frame.originalName ?? "anonymous"}</span>
              </div>
              <code>
                {frame.minifiedFile}:{frame.minifiedLine}:{frame.minifiedColumn}
              </code>
            </li>
          ))}
        </ol>
      ) : null}
      {resolution.unresolvedFrameCount > 0 ? (
        <p className="muted-text">{resolution.unresolvedFrameCount} frame(s) unresolved.</p>
      ) : null}
    </section>
  );
}
