import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api.dart';
import '../widgets/common.dart';
import 'scan_screen.dart';

class SecurityScreen extends StatefulWidget {
  const SecurityScreen({super.key, required this.onLogout});
  final VoidCallback onLogout;

  @override
  State<SecurityScreen> createState() => _SecurityScreenState();
}

class _SecurityScreenState extends State<SecurityScreen> {
  Map<String, dynamic>? _me;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final me = await Api.instance.get('/me');
    if (mounted) setState(() => _me = Map<String, dynamic>.from(me as Map));
  }

  Future<void> _setupMfa() async {
    try {
      final setup = await Api.instance.post('/auth/mfa/setup');
      if (!mounted) return;
      final secret = setup['secret'] as String;
      final code = await showDialog<String>(
        context: context,
        builder: (ctx) {
          final ctl = TextEditingController();
          return AlertDialog(
            title: const Text('Set up authenticator'),
            content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('Add this key to your authenticator app, then enter the 6-digit code it shows.'),
              const SizedBox(height: 12),
              SelectableText(secret, style: const TextStyle(fontFamily: 'monospace', fontWeight: FontWeight.bold)),
              TextButton.icon(
                onPressed: () => Clipboard.setData(ClipboardData(text: secret)),
                icon: const Icon(Icons.copy, size: 16),
                label: const Text('Copy key'),
              ),
              TextField(controller: ctl, keyboardType: TextInputType.number, maxLength: 6, decoration: const InputDecoration(labelText: 'Code', counterText: '')),
            ]),
            actions: [
              TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
              FilledButton(onPressed: () => Navigator.pop(ctx, ctl.text), child: const Text('Turn on')),
            ],
          );
        },
      );
      if (code == null) return;
      await Api.instance.post('/auth/mfa/enable', {'code': code});
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Two-factor authentication is on.')));
      _load();
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final me = _me;
    if (me == null) return const Center(child: CircularProgressIndicator());
    final mfa = me['mfaEnabled'] == true;
    final kyc = me['kycLevel'] as int;
    return ListView(padding: const EdgeInsets.all(16), children: [
      Text('Security', style: Theme.of(context).textTheme.headlineSmall),
      Text(me['email'] as String),
      const SizedBox(height: 16),
      Card(
        child: ListTile(
          leading: Icon(mfa ? Icons.verified_user : Icons.gpp_maybe, color: mfa ? Colors.green : Colors.orange),
          title: const Text('Two-factor authentication'),
          subtitle: Text(mfa ? 'On' : 'Off. Turn it on to protect your wallet.'),
          trailing: mfa ? null : FilledButton(onPressed: _setupMfa, child: const Text('Set up')),
        ),
      ),
      Card(
        child: ListTile(
          leading: Icon(kyc > 0 ? Icons.badge : Icons.badge_outlined, color: kyc > 0 ? Colors.green : Colors.orange),
          title: const Text('Identity verification'),
          subtitle: Text(kyc > 0 ? 'Verified (level $kyc)' : 'Not verified. Verify on the web app to raise your limits.'),
        ),
      ),
      Card(
        child: ListTile(
          leading: const Icon(Icons.qr_code_scanner),
          title: const Text('Scan to sign in on the web'),
          subtitle: const Text('Open the SecurePay website, choose “Scan QR code”, then scan it here.'),
          onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ScanScreen())),
        ),
      ),
      const SizedBox(height: 24),
      OutlinedButton(
        onPressed: () async {
          await Api.instance.logout();
          widget.onLogout();
        },
        child: const Text('Log out'),
      ),
    ]);
  }
}
