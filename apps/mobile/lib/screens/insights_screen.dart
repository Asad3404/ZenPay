import 'package:flutter/material.dart';

import '../api.dart';
import '../widgets/common.dart';

class InsightsScreen extends StatefulWidget {
  const InsightsScreen({super.key});

  @override
  State<InsightsScreen> createState() => _InsightsScreenState();
}

class _InsightsScreenState extends State<InsightsScreen> {
  Map<String, dynamic>? _data;
  String? _error;
  final _history = <Map<String, String>>[];
  final _input = TextEditingController();
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    Api.instance.get('/insights').then((d) {
      if (mounted) setState(() => _data = Map<String, dynamic>.from(d as Map));
    }).catchError((Object e) {
      if (mounted) setState(() => _error = e.toString());
    });
  }

  Future<void> _ask(String text) async {
    if (text.trim().isEmpty || _busy) return;
    final prior = List<Map<String, String>>.from(_history);
    setState(() {
      _history.add({'role': 'user', 'content': text});
      _busy = true;
      _input.clear();
    });
    try {
      final r = await Api.instance.post('/insights/assistant', {'message': text, 'history': prior});
      setState(() => _history.add({'role': 'assistant', 'content': r['reply'] as String}));
    } catch (e) {
      if (mounted) showError(context, e);
      setState(() => _history.removeLast());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    final cur = d?['currency'] as String? ?? 'USD';
    final scheme = Theme.of(context).colorScheme;
    return ListView(padding: const EdgeInsets.all(16), children: [
      Text('Insights', style: Theme.of(context).textTheme.headlineSmall),
      const SizedBox(height: 12),
      if (_error != null) Text(_error!, style: TextStyle(color: scheme.error)),
      if (d == null && _error == null) const Center(child: CircularProgressIndicator()),
      if (d != null) ...[
        Row(children: [
          Expanded(child: _Stat('Spent this month', money(d['thisMonth']['spent'], cur))),
          const SizedBox(width: 8),
          Expanded(child: _Stat('Next month (forecast)', money(d['forecastNextMonth'], cur))),
        ]),
        const SizedBox(height: 12),
        for (final c in (d['categories'] as List))
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [Text(c['category']), Text(money(c['amount'], cur))]),
              const SizedBox(height: 4),
              LinearProgressIndicator(
                value: (c['amount'] as num) / ((d['categories'] as List).first['amount'] as num),
                minHeight: 6,
                borderRadius: BorderRadius.circular(4),
              ),
            ]),
          ),
        if ((d['tips'] as List).isNotEmpty)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                for (final t in d['tips'] as List) Padding(padding: const EdgeInsets.symmetric(vertical: 4), child: Text('✦ $t')),
              ]),
            ),
          ),
      ],
      const SizedBox(height: 16),
      Text('Ask the assistant', style: Theme.of(context).textTheme.titleMedium),
      const SizedBox(height: 8),
      if (_history.isEmpty)
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final s in ['Where does my money go?', 'How much will I spend next month?', 'How can I save more?'])
            ActionChip(label: Text(s), onPressed: () => _ask(s)),
        ]),
      for (final m in _history)
        Align(
          alignment: m['role'] == 'user' ? Alignment.centerRight : Alignment.centerLeft,
          child: Container(
            margin: const EdgeInsets.symmetric(vertical: 4),
            padding: const EdgeInsets.all(12),
            constraints: const BoxConstraints(maxWidth: 320),
            decoration: BoxDecoration(
              color: m['role'] == 'user' ? scheme.primary : scheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(16),
            ),
            child: Text(m['content']!, style: TextStyle(color: m['role'] == 'user' ? scheme.onPrimary : null)),
          ),
        ),
      if (_busy) const Padding(padding: EdgeInsets.all(8), child: LinearProgressIndicator()),
      const SizedBox(height: 8),
      Row(children: [
        Expanded(child: TextField(controller: _input, decoration: const InputDecoration(hintText: 'Ask about your spending…'), onSubmitted: _ask)),
        IconButton.filled(onPressed: () => _ask(_input.text), icon: const Icon(Icons.send)),
      ]),
    ]);
  }
}

class _Stat extends StatelessWidget {
  const _Stat(this.label, this.value);
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Card(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label, style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: 4),
            Text(value, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w600)),
          ]),
        ),
      );
}
