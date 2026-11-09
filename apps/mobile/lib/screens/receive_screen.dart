import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../api.dart';
import '../widgets/common.dart';

class ReceiveScreen extends StatefulWidget {
  const ReceiveScreen({super.key});

  @override
  State<ReceiveScreen> createState() => _ReceiveScreenState();
}

class _ReceiveScreenState extends State<ReceiveScreen> {
  String? _payload;
  Map<String, dynamic>? _request;
  final _amount = TextEditingController();
  String _currency = 'USD';

  @override
  void initState() {
    super.initState();
    Api.instance.get('/payments/my-qr').then((r) {
      if (mounted) {
        setState(() {
          _payload = r['payload'] as String;
          _currency = r['currency'] as String;
        });
      }
    }).catchError((Object e) {
      if (mounted) showError(context, e);
    });
  }

  Future<void> _create() async {
    try {
      final r = await Api.instance.post('/payments/requests', {'amount': _amount.text, 'currency': _currency});
      setState(() => _request = Map<String, dynamic>.from(r as Map));
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  Widget _qr(String data) => Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16)),
        child: QrImageView(data: data, size: 220),
      );

  @override
  Widget build(BuildContext context) {
    final shown = _request?['payload'] as String? ?? _payload;
    return Scaffold(
      appBar: AppBar(title: const Text('Receive')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Center(child: shown == null ? const CircularProgressIndicator() : _qr(shown)),
        const SizedBox(height: 12),
        Text(
          _request == null
              ? 'Anyone with SecurePay can scan this to pay you.'
              : 'Scan to pay ${money(_request!['amount'], _request!['currency'])} · valid for 15 minutes',
          textAlign: TextAlign.center,
        ),
        const Divider(height: 40),
        Text('Request a specific amount', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 12),
        Row(children: [
          Expanded(child: TextField(controller: _amount, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Amount'))),
          const SizedBox(width: 12),
          DropdownButton<String>(
            value: _currency,
            items: currencies.map((c) => DropdownMenuItem(value: c, child: Text(c))).toList(),
            onChanged: (v) => setState(() => _currency = v!),
          ),
        ]),
        const SizedBox(height: 12),
        FilledButton(onPressed: _create, child: const Text('Create QR code')),
        if (_request != null) TextButton(onPressed: () => setState(() => _request = null), child: const Text('Show my personal code')),
      ]),
    );
  }
}
