import {
  MonoTypeOperatorFunction,
  ReplaySubject,
  share,
  ShareConfig,
} from "rxjs";

export function shareLastValue<T>(
  options?: Exclude<ShareConfig<T>, "connector">
): MonoTypeOperatorFunction<T> {
  return (source) =>
    source.pipe(
      share({
        connector: () => new ReplaySubject(1),
        resetOnRefCountZero: options?.resetOnRefCountZero ?? true,
        resetOnComplete: options?.resetOnComplete ?? true,
        resetOnError: options?.resetOnError ?? true,
      })
    );
}
