import 'package:flutter/material.dart';

import '../api.dart';
import '../widgets/common.dart';

class SendScreen extends StatefulWidget {
  const SendScreen({super.key});

  @override
  State<SendScreen> createState() => _SendScreenState();
}

class _SendScreenState extends State<SendScreen> {
  final _query = TextEditingController();
  final _amount = TextEditingController();
  final _note = TextEditingController();
  String _currency = 'USD';
  Map<String, dynamic>? _recipient;
  String _key = Api.instance.newKey();
  bool _busy = false;

  Future<void> _find() async {
    try {
      final r = await Api.instance.get('/transfers/lookup?q=${Uri.encodeQueryComponent(_query.text.trim())}');
      setState(() => _recipient = Map<String, dynamic>.from(r as Map));
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  Future<void> _send() async {
    setState(() => _busy = true);
    try {
      final result = await withMfa(context, (code) => Api.instance.post('/transfers', {
            'recipientId': _recipient!['id'],
            'amount': _amount.text,
            'currency': _currency,
            if (_note.text.isNotEmpty) 'note': _note.text,
            'idempotencyKey': _key,
            if (code != null) 'mfaCode': code,
          }));
      if (result == null || !mounted) return;
      final held = result['status'] == 'held';
      await showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          icon: Icon(held ? Icons.hourglass_top : Icons.check_circle, color: held ? Colors.orange : Colors.green, size: 40),
          title: Text(held ? 'Payment under review' : 'Money sent'),
          content: Text(held
              ? 'For your security this payment is on hold while our team reviews it. You’ll be notified shortly.'
              : '${money(_amount.text, _currency)} to ${_recipient!['fullName']}.'),
          actions: [FilledButton(onPressed: () => Navigator.pop(ctx), child: const Text('Done'))],
        ),
      );
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      if (mounted) showError(context, e);
      _key = Api.instance.newKey();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Send money')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Row(children: [
          Expanded(child: TextField(controller: _query, keyboardType: TextInputType.emailAddress, decoration: const InputDecoration(labelText: 'Email or phone'))),
          const SizedBox(width: 8),
          OutlinedButton(onPressed: _find, child: const Text('Find')),
        ]),
        if (_recipient != null) ...[
          const SizedBox(height: 12),
          ListTile(
            leading: CircleAvatar(child: Text((_recipient!['fullName'] as String)[0])),
            title: Text(_recipient!['fullName']),
            subtitle: Text(_recipient!['maskedEmail']),
          ),
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
          TextField(controller: _note, maxLength: 140, decoration: const InputDecoration(labelText: 'Note (optional)')),
          const SizedBox(height: 8),
          FilledButton(
            onPressed: _busy ? null : _send,
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
            child: _busy ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Send'),
          ),
        ],
      ]),
    );
  }
}
