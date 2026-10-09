import * as vscode from 'vscode';
import { isClientCommand, type ClientCommand, type HostMessage } from '../core/protocol';
import { makeNonce, renderAppHtml, webviewCsp } from '../host/html';

/**
 * The tour itself: a singleton webview panel running the browser app
 * (Tour / Dashboard / Work display modes, PRD §7). The webview's context is
 * not retained while hidden, so nothing renders when the tour is out of sight
 * (PRD §25); the app reloads and says `ready` again when it is shown.
 */

export interface TourPanelOptions {
  extensionUri: vscode.Uri;
  /** The `hello` message for this display (host info, catalog, prefs). */
  hello(): HostMessage;
  latest(): HostMessage | undefined;
  onCommand(cmd: ClientCommand): void;
  onVisibilityChange(visible: boolean): void;
}

const QUEUE_MAX = 8;

export class TourPanel implements vscode.Disposable {
  static readonly viewType = 'vibetour.tour';
  private panel?: vscode.WebviewPanel;
  /** The app inside the current webview has said `ready`. */
  private ready = false;
  /** Messages for the app that must survive it (re)loading, e.g. "show passport". */
  private queue: HostMessage[] = [];

  constructor(private readonly opts: TourPanelOptions) {}

  get isOpen(): boolean {
    return !!this.panel;
  }

  get visible(): boolean {
    return !!this.panel?.visible;
  }

  show(column: vscode.ViewColumn, preserveFocus = false): void {
    if (this.panel) {
      this.panel.reveal(undefined, preserveFocus);
      return;
    }
    const root = vscode.Uri.joinPath(this.opts.extensionUri, 'dist', 'webview');
    const panel = vscode.window.createWebviewPanel(
      TourPanel.viewType,
      'VibeTour',
      { viewColumn: column, preserveFocus },
      { enableScripts: true, localResourceRoots: [root], retainContextWhenHidden: false },
    );
    this.panel = panel;
    this.ready = false;
    panel.iconPath = vscode.Uri.joinPath(root, 'favicon.svg');
    panel.webview.html = this.html(panel.webview, root);
    panel.webview.onDidReceiveMessage((raw: unknown) => this.receive(raw));
    panel.onDidChangeViewState(() => {
      // A hidden webview without retained context is torn down; it says `ready` again when shown.
      if (!panel.visible) this.ready = false;
      this.opts.onVisibilityChange(panel.visible);
    });
    panel.onDidDispose(() => {
      if (this.panel !== panel) return;
      this.panel = undefined;
      this.ready = false;
      this.queue = [];
      this.opts.onVisibilityChange(false);
    });
    this.opts.onVisibilityChange(true);
  }

  /** Posts to the app if it is on screen; `queue` keeps the message until the app is ready. */
  post(msg: HostMessage, queue = false): void {
    if (this.panel && this.ready && this.panel.visible) {
      this.panel.webview.postMessage(msg).then(undefined, () => undefined);
    } else if (queue && this.panel) {
      this.queue = [...this.queue.filter((m) => m.type !== msg.type), msg].slice(-QUEUE_MAX);
    }
  }

  close(): void {
    this.panel?.dispose();
  }

  dispose(): void {
    this.close();
  }

  private receive(raw: unknown): void {
    if (!isClientCommand(raw)) return;
    if (raw.type !== 'ready') {
      this.opts.onCommand(raw);
      return;
    }
    this.ready = true;
    this.post(this.opts.hello());
    const latest = this.opts.latest();
    if (latest) this.post(latest);
    const queued = this.queue;
    this.queue = [];
    for (const msg of queued) this.post(msg);
  }

  private html(webview: vscode.Webview, root: vscode.Uri): string {
    const nonce = makeNonce();
    return renderAppHtml({
      boot: { host: 'vscode' },
      nonce,
      csp: webviewCsp(webview.cspSource, nonce),
      asset: (name) => webview.asWebviewUri(vscode.Uri.joinPath(root, name)).toString(),
    });
  }
}
