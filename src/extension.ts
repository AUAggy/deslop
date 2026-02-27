import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
	console.log('Humanizer extension is now active');

	const disposable = vscode.commands.registerCommand('humanizer.humanizeSelection', () => {
		vscode.window.showInformationMessage('Humanize Selection: not yet implemented');
	});

	context.subscriptions.push(disposable);
}

export function deactivate() {}
