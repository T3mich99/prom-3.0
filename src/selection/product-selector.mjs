import { validateRunRequest } from './run-request.mjs';

export function selectProducts(request) {
  validateRunRequest(request);

  const selectedProducts = [];
  const selectedKeys = new Set();
  const categoryReports = [];
  let totalCandidates = 0;
  let totalDuplicates = 0;

  for (const category of request.categories) {
    const resolutionStatus = category.resolution === 'notFound' ? 'notFound' : 'resolved';
    const requestedLimit = category.limit === undefined ? null : category.limit;
    const report = {
      requestKey: category.requestKey,
      requestedName: category.requestedName,
      resolutionStatus,
      resolvedCategory: resolutionStatus === 'resolved' ? category.resolvedCategory : null,
      candidateCount: category.candidates.length,
      requestedLimit,
      selectedCount: 0,
      duplicateCount: 0,
      shortfall: requestedLimit === null ? 0 : requestedLimit,
    };
    totalCandidates += report.candidateCount;

    for (const candidate of category.candidates) {
      if (request.totalLimit !== undefined && selectedProducts.length >= request.totalLimit) break;
      if (requestedLimit !== null && report.selectedCount >= requestedLimit) break;
      if (selectedKeys.has(candidate.selectionKey)) {
        report.duplicateCount += 1;
        totalDuplicates += 1;
        continue;
      }

      selectedKeys.add(candidate.selectionKey);
      report.selectedCount += 1;
      selectedProducts.push({
        requestKey: category.requestKey,
        requestedCategory: category.requestedName,
        resolvedCategory: report.resolvedCategory,
        selectionKey: candidate.selectionKey,
        product: candidate.product,
      });
    }

    if (requestedLimit !== null) report.shortfall = Math.max(requestedLimit - report.selectedCount, 0);
    categoryReports.push(report);
  }

  return {
    selectedProducts,
    categories: categoryReports,
    summary: {
      requestedCategoryCount: request.categories.length,
      resolvedCategoryCount: categoryReports.filter((category) => category.resolutionStatus === 'resolved').length,
      unresolvedCategoryCount: categoryReports.filter((category) => category.resolutionStatus === 'notFound').length,
      candidateCount: totalCandidates,
      selectedCount: selectedProducts.length,
      duplicateCount: totalDuplicates,
      totalLimit: request.totalLimit === undefined ? null : request.totalLimit,
    },
  };
}
