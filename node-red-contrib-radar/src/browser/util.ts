import { DependencyList, useState, useEffect } from "react";
import { Observable } from "rxjs";

export function useObservable<T>(
  observableOrFactory: (() => Observable<T>) | Observable<T>,
  deps: DependencyList = []
) {
  const [state, setState] = useState<T>();

  useEffect(() => {
    const observable =
      observableOrFactory instanceof Observable
        ? observableOrFactory
        : observableOrFactory();
    const sub = observable.subscribe({
      next: (v) => setState(v),
    });
    return () => sub.unsubscribe();
  }, deps);

  return state;
}
