using System.Collections.Generic;

namespace Reproducer.Services
{
    // Control item — plain class, not MVC-related. Should be indexed by the
    // extractor on every version (buggy or fixed). If this class is missing
    // from the extracted output, the failure is not LIM-40151 specifically —
    // something else broke the whole extraction job for the repo.
    public class InventoryService
    {
        private readonly Dictionary<string, int> _stockByItemKey = new();

        public int CountFor(string itemKey)
            => _stockByItemKey.TryGetValue(itemKey, out var stock) ? stock : 0;

        public void Receive(string itemKey, int quantity)
        {
            _stockByItemKey.TryGetValue(itemKey, out var current);
            _stockByItemKey[itemKey] = current + quantity;
        }

        public bool IsInStock(string itemKey) => CountFor(itemKey) > 0;
    }
}
