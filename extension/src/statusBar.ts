import * as vscode from 'vscode';

/**
 * Status bar item that shows current token balance.
 * Format: "🎫 12/50 tokens"
 */
export class StatusBarManager {
  private item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = 'tokenTracker.enterKey';
    this.item.tooltip = 'Click to enter your Token Key';
    this.item.show();
    this.setNotActivated();
  }

  /** Show not-activated state — needs token key */
  setNotActivated(): void {
    this.item.text = '$(key) Token Tracker';
    this.item.tooltip = 'Click to enter your Token Key';
    this.item.command = 'tokenTracker.enterKey';
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }

  /** Show loading state */
  setLoading(): void {
    this.item.text = '$(sync~spin) Tokens...';
    this.item.backgroundColor = undefined;
  }

  /** Update with current balance */
  update(used: number, allocated: number, isBlocked: boolean): void {
    const remaining = allocated - used;
    this.item.text = `$(credit-card) ${remaining}/${allocated} tokens`;
    this.item.command = 'tokenTracker.showBalance';

    if (isBlocked) {
      this.item.text = `$(error) BLOCKED`;
      this.item.tooltip = 'Device is blocked by admin';
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else if (remaining <= 0) {
      this.item.text = `$(warning) 0/${allocated} tokens`;
      this.item.tooltip = 'Token limit reached! Contact admin for more.';
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else if (remaining <= 10) {
      this.item.tooltip = `Low tokens! ${remaining} remaining this month.`;
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      this.item.tooltip = `${remaining} tokens remaining this month. Click for details.`;
      this.item.backgroundColor = undefined;
    }
  }

  /** Show offline/disconnected state */
  setOffline(remaining: number, allocated: number): void {
    this.item.text = `$(cloud-offline) ${remaining}/${allocated} tokens`;
    this.item.tooltip = 'Offline — using cached balance. Will sync when reconnected.';
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }

  /** Show error state */
  setError(message: string): void {
    this.item.text = `$(error) Token Tracker`;
    this.item.tooltip = message;
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
  }

  dispose(): void {
    this.item.dispose();
  }
}
