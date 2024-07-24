/*
Copyright 2024 Adobe
All Rights Reserved.

NOTICE: Adobe permits you to use, modify, and distribute this file in
accordance with the terms of the Adobe license agreement accompanying
it.
*/

import { v4 as uuidv4 } from 'uuid';

import { updateSearchInputCtx, updateSearchResultsCtx } from '../context';
import {
  AttributeMetadataResponse,
  ClientProps,
  MagentoHeaders,
  ProductSearchQuery,
  ProductSearchResponse,
  RefinedProduct,
  RefineProductQuery,
} from '../types/interface';
import { SEARCH_UNIT_ID } from '../utils/constants';
import {
  ATTRIBUTE_METADATA_QUERY,
  PRODUCT_SEARCH_QUERY,
  REFINE_PRODUCT_QUERY,
} from './queries';

const getHeaders = (headers: MagentoHeaders) => {
  return {
    'Magento-Environment-Id': headers.environmentId,
    'Magento-Website-Code': headers.websiteCode,
    'Magento-Store-Code': headers.storeCode,
    'Magento-Store-View-Code': headers.storeViewCode,
    'X-Api-Key': headers.apiKey,
    'X-Request-Id': headers.xRequestId,
    'Content-Type': 'application/json',
    'Magento-Customer-Group': headers.customerGroup,
  };
};

const getProductSearch = async ({
  environmentId,
  websiteCode,
  storeCode,
  storeViewCode,
  apiKey,
  apiUrl,
  phrase,
  pageSize = 24,
  displayOutOfStock,
  currentPage = 1,
  xRequestId = uuidv4(),
  filter = [],
  sort = [],
  context,
  categorySearch = false,
}: ProductSearchQuery & ClientProps): Promise<
  ProductSearchResponse['data']
> => {
  const variables = {
    phrase,
    pageSize,
    currentPage,
    filter,
    sort,
    context,
  };

  // default filters if search is "catalog (category)" or "search"
  let searchType = 'Search';
  if (categorySearch) {
    searchType = 'Catalog';
  }
  const defaultFilters = {
    attribute: 'visibility',
    in: [searchType, 'Catalog, Search'],
  };

  variables.filter.push(defaultFilters); //add default visibility filter

  const displayInStockOnly = displayOutOfStock != '1'; // '!=' is intentional for conversion

  const inStockFilter = {
    attribute: 'inStock',
    eq: 'true',
  };

  if (displayInStockOnly) {
    variables.filter.push(inStockFilter);
  }

  const headers = getHeaders({
    environmentId,
    websiteCode,
    storeCode,
    storeViewCode,
    apiKey,
    xRequestId,
    customerGroup: context?.customerGroup ?? '',
  });

  // ======  initialize data collection =====
  const searchRequestId = uuidv4();

  updateSearchInputCtx(
    SEARCH_UNIT_ID,
    searchRequestId,
    phrase,
    filter,
    pageSize,
    currentPage,
    sort
  );

  const magentoStorefrontEvtPublish = window.magentoStorefrontEvents?.publish;

  magentoStorefrontEvtPublish?.searchRequestSent &&
    magentoStorefrontEvtPublish.searchRequestSent(SEARCH_UNIT_ID);
  // ======  end of data collection =====

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query: PRODUCT_SEARCH_QUERY,
      variables: { ...variables },
    }),
  });

  const results = await response.json();
  
  // ======  start of size reorder =====
  const out = orderSizes(
    results.data.productSearch.facets.filter((facet: any) => facet.attribute === 'size')
  );
  if (out?.buckets?.length > 0) {
    const start:any[] = [];
    const end: any[] = [];
    results.data.productSearch.facets.forEach( (item: any, index: any) => {
      if(item.attribute === 'size') {
        start.push(results.data.productSearch.facets.slice(0, index));
        end.push(results.data.productSearch.facets.slice(index + 1));
      }
    });
    if (start.length > 0 || end.length > 0) {
      results.data.productSearch.facets = [];
      results.data.productSearch.facets.push(...start.flat(), out, ...end.flat());
    }
  }
  // ======  end of size reorder =====

  // ======  initialize data collection =====
  updateSearchResultsCtx(
    SEARCH_UNIT_ID,
    searchRequestId,
    results?.data?.productSearch
  );

  magentoStorefrontEvtPublish?.searchResponseReceived &&
    magentoStorefrontEvtPublish.searchResponseReceived(SEARCH_UNIT_ID);

  if (categorySearch) {
    magentoStorefrontEvtPublish?.categoryResultsView &&
      magentoStorefrontEvtPublish.categoryResultsView(SEARCH_UNIT_ID);
  } else {
    magentoStorefrontEvtPublish?.searchResultsView &&
      magentoStorefrontEvtPublish.searchResultsView(SEARCH_UNIT_ID);
  }
  // ======  end of data collection =====

  return results?.data;
};

const orderSizes = (sizes: any) => {
  const values = [
    'Único', 'U', 'XPP', 'PP', 'P', 'M', 'G', 'GG', 'GG1', 'GG2', 'GG3', 'EGG',
    '34', '36', '38', '40', '42', '44', '46', '48', '50', '52', '54', '56'
  ];
  const maxIndex = values.length;
  const buckets = sizes[0].buckets.sort((a: any, b: any) => {
    const aSize = values.indexOf(a.title);
    const bSize = values.indexOf(b.title);
    const aIndex = aSize !== -1 ? aSize : maxIndex;
    const bIndex = bSize !== -1 ? bSize : maxIndex;
    return aIndex - bIndex;
  });
  return { ...sizes[0], buckets };
}

const getAttributeMetadata = async ({
  environmentId,
  websiteCode,
  storeCode,
  storeViewCode,
  apiKey,
  apiUrl,
  xRequestId = uuidv4(),
}: ClientProps): Promise<AttributeMetadataResponse['data']> => {
  const headers = getHeaders({
    environmentId,
    websiteCode,
    storeCode,
    storeViewCode,
    apiKey,
    xRequestId,
    customerGroup: '',
  });

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query: ATTRIBUTE_METADATA_QUERY,
    }),
  });
  const results = await response.json();
  return results?.data;
};

const refineProductSearch = async ({
  environmentId,
  websiteCode,
  storeCode,
  storeViewCode,
  apiKey,
  apiUrl,
  xRequestId = uuidv4(),
  context,
  optionIds,
  sku,
}: RefineProductQuery & ClientProps): Promise<RefinedProduct> => {
  const variables = {
    optionIds,
    sku,
  };

  const headers = getHeaders({
    environmentId,
    websiteCode,
    storeCode,
    storeViewCode,
    apiKey,
    xRequestId,
    customerGroup: context?.customerGroup ?? '',
  });

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query: REFINE_PRODUCT_QUERY,
      variables: { ...variables },
    }),
  });
  const results = await response.json();
  return results?.data;
};

export { getAttributeMetadata, getProductSearch, refineProductSearch };
