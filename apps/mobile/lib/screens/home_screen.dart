import 'package:flutter/material.dart';

import '../api.dart';
import '../widgets/common.dart';
import 'insights_screen.dart';
import 'receive_screen.dart';
import 'scan_screen.dart';
import 'security_screen.dart';
import 'send_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.onLogout});
  final VoidCallback onLogout;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _tab = 0;

  @override
  Widget build(BuildContext context) {
    final pages = [
      const WalletTab(),
      const InsightsScreen(),
      SecurityScreen(onLogout: widget.onLogout),
    ];
    return Scaffold(
      body: SafeArea(child: pages[_tab]),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) => setState(() => _tab = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.account_balance_wallet_outlined), selectedIcon: Icon(Icons.account_balance_wallet), label: 'Wallet'),
          NavigationDestination(icon: Icon(Icons.insights_outlined), selectedIcon: Icon(Icons.insights), label: 'Insights'),
          NavigationDestination(icon: Icon(Icons.shield_outlined), selectedIcon: Icon(Icons.shield), label: 'Security'),
        ],
      ),
    );
  }
}

class WalletTab extends StatefulWidget {
  const WalletTab({super.key});

  @override
  State<WalletTab> createState() => _WalletTabState();
}

class _WalletTabState extends State<WalletTab> {
  Map<String, dynamic>? _overview;
  List<dynamic> _tx = [];
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([Api.instance.get('/wallets'), Api.instance.get('/wallets/transactions?limit=20')]);
      if (!mounted) return;
      setState(() {
        _overview = results[0] as Map<String, dynamic>;
        _tx = results[1] as List<dynamic>;
        _error = null;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _open(Widget screen) async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => screen));
    _load();
  }

  Future<void> _addMoney() async {
    final amount = TextEditingController();
    var currency = (_overview?['baseCurrency'] as String?) ?? 'USD';
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheet) => Padding(
          padding: EdgeInsets.fromLTRB(20, 20, 20, MediaQuery.of(ctx).viewInsets.bottom + 20),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text('Add money', style: Theme.of(ctx).textTheme.titleLarge),
            const SizedBox(height: 4),
            const Text('Sandbox: top-ups are simulated.'),
            const SizedBox(height: 16),
            Row(children: [
              Expanded(child: TextField(controller: amount, autofocus: true, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Amount'))),
              const SizedBox(width: 12),
              DropdownButton<String>(
                value: currency,
                items: currencies.map((c) => DropdownMenuItem(value: c, child: Text(c))).toList(),
                onChanged: (v) => setSheet(() => currency = v!),
              ),
            ]),
            const SizedBox(height: 16),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Add money')),
          ]),
        ),
      ),
    );
    if (ok != true || amount.text.isEmpty) return;
    try {
      await Api.instance.post('/wallets/deposit', {'amount': amount.text, 'currency': currency, 'idempotencyKey': Api.instance.newKey()});
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Added ${money(amount.text, currency)}')));
      _load();
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final name = (Api.instance.user?['fullName'] as String? ?? '').split(' ').first;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('Hi, $name', style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 16),
          if (_error != null) Text(_error!, style: TextStyle(color: scheme.error)),
          Card(
            color: scheme.primary,
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('Total balance', style: TextStyle(color: scheme.onPrimary.withValues(alpha: 0.8))),
                const SizedBox(height: 4),
                Text(
                  _overview == null ? '…' : money(_overview!['totalInBase'], _overview!['baseCurrency']),
                  style: TextStyle(color: scheme.onPrimary, fontSize: 34, fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 16),
                Wrap(spacing: 8, runSpacing: 8, children: [
                  _Action(icon: Icons.north_east, label: 'Send', onTap: () => _open(const SendScreen())),
                  _Action(icon: Icons.qr_code_scanner, label: 'Scan', onTap: () => _open(const ScanScreen())),
                  _Action(icon: Icons.qr_code_2, label: 'Receive', onTap: () => _open(const ReceiveScreen())),
                  _Action(icon: Icons.add, label: 'Add', onTap: _addMoney),
                ]),
              ]),
            ),
          ),
          const SizedBox(height: 16),
          if (_overview != null)
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final w in _overview!['wallets'] as List)
                  Chip(label: Text('${w['currency']}  ${money(w['balance'], w['currency'])}')),
              ],
            ),
          const SizedBox(height: 16),
          Text('Recent activity', style: Theme.of(context).textTheme.titleMedium),
          if (_tx.isEmpty) const Padding(padding: EdgeInsets.all(24), child: Center(child: Text('No transactions yet.'))),
          for (final t in _tx) TxTile(Map<String, dynamic>.from(t as Map)),
        ],
      ),
    );
  }
}

class _Action extends StatelessWidget {
  const _Action({required this.icon, required this.label, required this.onTap});
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final on = Theme.of(context).colorScheme.onPrimary;
    return Material(
      color: on.withValues(alpha: 0.15),
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            Icon(icon, color: on, size: 18),
            const SizedBox(width: 6),
            Text(label, style: TextStyle(color: on, fontWeight: FontWeight.w600)),
          ]),
        ),
      ),
    );
  }
}
