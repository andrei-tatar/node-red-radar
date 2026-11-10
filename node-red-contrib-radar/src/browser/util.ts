import { DependencyList, useState, useEffect } from "react";
import { Observable } from "rxjs";
import { retryRpc } from "./ws";

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
    // retryRpc resubscribes after the socket drops (e.g. a Node-RED redeploy)
    const sub = observable.pipe(retryRpc()).subscribe({
      next: (v) => setState(v),
      error: (err) => console.error(err),
    });
    return () => sub.unsubscribe();
  }, deps);

  return state;
}
