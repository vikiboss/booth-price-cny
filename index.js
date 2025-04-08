// ==UserScript==
// @name        booth.pm 人民币价格显示
// @namespace   Violentmonkey Scripts
// @match       https://booth.pm/*
// @grant       GM_xmlhttpRequest
// @grant       GM_setValue
// @grant       GM_getValue
// @connect     60s-api.viki.moe
// @version     2.6
// @author      Viki <hi@viki.moe> (https://github.com/vikiboss)
// @description 显示 booth.pm 上日元价格对应的人民币价格，使用实时汇率 API
// ==/UserScript==

(async () => {
  // 在文档头部注入样式
  const injectStyles = () => {
    const styleElement = document.createElement('style');
    styleElement.textContent = `
      .booth-free-badge {
        display: inline-flex;
        align-items: center;
        font-weight: 600;
        font-size: 0.95em;
        padding: 0.15em 0.5em;
        border-radius: 4px;
        background: linear-gradient(135deg, #ff7043, #ff5252);
        color: white;
        box-shadow: 0 1px 3px rgba(0,0,0,0.12);
        text-shadow: 0 1px 1px rgba(0,0,0,0.1);
        margin: 0 0.15em;
        position: relative;
        overflow: hidden;
        transform: translateZ(0);
      }

      .booth-free-badge::before {
        content: "";
        position: absolute;
        top: 0;
        left: -100%;
        width: 100%;
        height: 100%;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
        animation: shine 2s infinite;
      }

      @keyframes shine {
        0% { left: -100%; }
        20% { left: 100%; }
        100% { left: 100%; }
      }

      .booth-jpy-note {
        font-size: 0.85em;
        opacity: 0.8;
        margin-left: 0.3em;
      }

      .booth-cny-price {
        display: inline-block;
        color: #119da4;
        font-weight: 500;
        font-size: 0.9em;
      }

      /* 价格筛选器样式 */
      .booth-filter-cny {
        display: block;
        color: #119da4;
        font-size: 0.85em;
        margin-top: 2px;
      }
    `;
    document.head.appendChild(styleElement);
  };

  // 计算当天结束时间（23:59:59.999）的时间戳
  const getTodayEndTimestamp = () => {
    const today = new Date();
    const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
    return todayEnd.getTime();
  };

  // 获取汇率（优先使用缓存，每天更新一次）
  const getExchangeRate = () => {
    return new Promise(resolve => {
      // 检查缓存是否存在且当天有效
      const cachedRate = GM_getValue('jpy_to_cny_rate');
      const cacheTimestamp = GM_getValue('jpy_to_cny_rate_timestamp');
      const cacheExpiry = GM_getValue('jpy_to_cny_rate_expiry');

      // 如果有缓存且未过期
      if (cachedRate && cacheExpiry && Date.now() < cacheExpiry) {
        console.log(`汇率数据(缓存): 1 JPY = ${cachedRate} CNY，获取时间: ${new Date(cacheTimestamp).toLocaleString()}`);
        resolve({
          rate: parseFloat(cachedRate),
          isFromCache: true,
          timestamp: cacheTimestamp
        });
        return;
      }

      // 缓存过期或不存在，请求新数据
      const requestTime = Date.now();
      console.log(`请求最新汇率数据，时间: ${new Date(requestTime).toLocaleString()}`);

      GM_xmlhttpRequest({
        method: 'GET',
        url: 'https://60s-api.viki.moe/v2/exchange_rate?currency=jpy',
        responseType: 'json',
        onload: response => {
          try {
            const data = response.response;
            const responseTime = Date.now();

            if (data && data.code === 200) {
              // 查找日元到人民币的汇率
              const cnyRate = data.data.rates.find(item => item.currency === 'CNY')?.rate || 0.05;

              // 保存到GM缓存，设置到当天结束过期
              GM_setValue('jpy_to_cny_rate', cnyRate.toString());
              GM_setValue('jpy_to_cny_rate_timestamp', responseTime);
              GM_setValue('jpy_to_cny_rate_expiry', getTodayEndTimestamp());

              console.log(`汇率数据(最新): 1 JPY = ${cnyRate} CNY，获取时间: ${new Date(responseTime).toLocaleString()}`);
              resolve({
                rate: cnyRate,
                isFromCache: false,
                timestamp: responseTime
              });
              return;
            }

            // API返回格式不正确，使用默认汇率
            console.error('汇率API返回数据格式不正确，使用默认汇率');
            resolve({
              rate: 0.05,
              isFromCache: false,
              timestamp: responseTime
            });
          } catch (error) {
            console.error('解析汇率数据失败:', error);
            resolve({
              rate: 0.05,
              isFromCache: false,
              timestamp: Date.now()
            });
          }
        },
        onerror: error => {
          console.error('汇率API请求失败:', error);
          resolve({
            rate: 0.05,
            isFromCache: false,
            timestamp: Date.now()
          });
        },
        ontimeout: () => {
          console.error('汇率API请求超时');
          resolve({
            rate: 0.05,
            isFromCache: false,
            timestamp: Date.now()
          });
        },
        timeout: 5000 // 5秒超时
      });
    });
  };

  // 格式化日元转换为人民币的金额
  const formatCnyAmount = (jpyAmount, exchangeRate) => {
    if (!jpyAmount || isNaN(jpyAmount)) return '0';
    return (jpyAmount * exchangeRate).toFixed(2).replace(/\.00$/, '');
  };

  // 提取数字金额
  const extractAmountFromText = (text) => {
    // 提取纯数字部分，去除千位分隔符等
    const matches = text.match(/\d+(?:,\d+)*/);
    if (matches && matches[0]) {
      return parseInt(matches[0].replace(/,/g, ''));
    }
    return 0;
  };

  // 检查元素是否已被处理
  const isElementProcessed = (element) => {
    return element && element.dataset && element.dataset.priceProcessed === 'true';
  };

  // 注入样式
  injectStyles();

  // 获取汇率
  const { rate: exchangeRate } = await getExchangeRate();

  // 处理价格筛选器
  const processPriceFilter = () => {
    try {
      // 查找价格筛选器部分
      const priceFilters = document.querySelectorAll('.flex.w-full.justify-between');

      priceFilters.forEach(filterContainer => {
        // 已处理过的跳过
        if (filterContainer.dataset && filterContainer.dataset.processed === 'true') return;

        // 查找价格标签（一般是左右两个价格）
        const priceLabels = filterContainer.querySelectorAll('div');

        for (const priceLabel of priceLabels) {
          // 检查是否包含价格格式 "¥xxx"
          if (priceLabel.textContent.includes('¥') && !priceLabel.querySelector('.booth-cny-price')) {
            const jpyText = priceLabel.textContent;
            const jpyAmount = extractAmountFromText(jpyText);

            // 是否为0价格
            if (jpyAmount === 0 && !jpyText.includes('Free')) {
              // 保存原始内容
              const originalText = priceLabel.textContent;

              // 清空内容以重建
              priceLabel.innerHTML = '';

              if (originalText.trim() === '¥0') {
                // 创建"Free"徽章
                const freeBadge = document.createElement('span');
                freeBadge.className = 'booth-free-badge';
                freeBadge.style.fontSize = '0.75em';
                freeBadge.style.padding = '0.1em 0.35em';
                freeBadge.textContent = 'FREE';
                priceLabel.appendChild(freeBadge);
              } else {
                // 可能是价格范围中的一部分，保留原文本
                priceLabel.textContent = originalText;
              }
            } else {
              // 非0价格，添加CNY价格
              const cnyAmount = formatCnyAmount(jpyAmount, exchangeRate);

              // 保存原始内容
              const originalText = priceLabel.textContent;

              // 创建包含原价格和CNY价格的结构
              priceLabel.innerHTML = '';

              // 原价格
              const jpySpan = document.createElement('span');
              jpySpan.textContent = originalText;
              priceLabel.appendChild(jpySpan);

              // CNY价格（在下方显示）
              const cnySpan = document.createElement('span');
              cnySpan.className = 'booth-filter-cny';
              cnySpan.textContent = `￥${cnyAmount}`;
              priceLabel.appendChild(cnySpan);
            }
          }
        }

        // 标记为已处理
        if (filterContainer.dataset) {
          filterContainer.dataset.processed = 'true';
        }
      });
    } catch (error) {
      console.error('处理价格筛选器时出错:', error);
    }
  };

  // 处理普通的价格文本
  const processRegularPrices = () => {
    try {
      // 匹配两种常见的价格格式
      const jpyRegex = /^(\s*)(\d+(?:,\d+)*)(\s*)JPY(\s*)(~)?(\s*)$/i;
      const yenRegex = /^(\s*)¥\s*(\d+(?:,\d+)*)(\s*)(~)?(\s*)$/;

      // 遍历文本节点
      const treeWalker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: node => {
            // 检查节点及其父节点是否存在
            if (!node || !node.parentNode) {
              return NodeFilter.FILTER_REJECT;
            }

            // 跳过脚本、样式等标签内的文本
            if (node.parentNode.tagName?.match(/^(SCRIPT|STYLE|TEXTAREA|OPTION)$/i)) {
              return NodeFilter.FILTER_REJECT;
            }

            // 检查是否已处理 - 安全地访问dataset
            if (node.parentNode.dataset && node.parentNode.dataset.priceProcessed === 'true') {
              return NodeFilter.FILTER_REJECT;
            }

            // 检查节点值是否存在
            if (!node.nodeValue) {
              return NodeFilter.FILTER_REJECT;
            }

            // 检查是否包含价格格式
            if (jpyRegex.test(node.nodeValue) || yenRegex.test(node.nodeValue)) {
              return NodeFilter.FILTER_ACCEPT;
            }

            return NodeFilter.FILTER_SKIP;
          }
        }
      );

      // 需要处理的节点
      const nodesToProcess = [];
      let node;
      while (node = treeWalker.nextNode()) {
        if (node && node.parentNode) {
          nodesToProcess.push(node);
        }
      }

      // 处理收集的节点
      for (const textNode of nodesToProcess) {
        // 再次检查节点是否有效
        if (!textNode || !textNode.parentNode || !textNode.nodeValue) continue;

        const text = textNode.nodeValue;
        let match = text.match(jpyRegex);
        let isJPY = true;

        if (!match) {
          match = text.match(yenRegex);
          isJPY = false;
          if (!match) continue; // 没有匹配到任何价格格式
        }

        const [_, leading, amount, middle, trailing1, tilde, trailing2] = match;
        const tildeStr = tilde || '';

        // 解析价格金额
        const jpyAmount = parseInt(amount.replace(/,/g, ''));

        // 处理0金额 - 显示Free
        if (jpyAmount === 0) {
          const fragment = document.createDocumentFragment();

          // 添加前导空白
          if (leading) {
            fragment.appendChild(document.createTextNode(leading));
          }

          // 创建Free徽章
          const freeBadge = document.createElement('span');
          freeBadge.className = 'booth-free-badge';
          freeBadge.textContent = 'FREE';
          fragment.appendChild(freeBadge);

          // 添加JPY标注（仅对JPY格式）
          if (isJPY) {
            const jpyNote = document.createElement('span');
            jpyNote.className = 'booth-jpy-note';
            jpyNote.textContent = '(0 JPY)';
            fragment.appendChild(jpyNote);
          }

          // 添加尾随文本
          const trailing = `${trailing1 || ''}${tildeStr}${trailing2 || ''}`;
          if (trailing) {
            fragment.appendChild(document.createTextNode(trailing));
          }

          // 替换原节点
          textNode.parentNode.replaceChild(fragment, textNode);
        } else {
          // 非0价格 - 添加CNY转换
          const cnyAmount = formatCnyAmount(jpyAmount, exchangeRate);

          if (isJPY) {
            // JPY格式
            textNode.nodeValue = `${leading}${amount}${middle}JPY (${cnyAmount} CNY)${trailing1}${tildeStr}${trailing2}`;
          } else {
            // ¥格式
            const fragment = document.createDocumentFragment();

            // 添加前导空白
            if (leading) {
              fragment.appendChild(document.createTextNode(leading));
            }

            // 原始价格
            const jpySpan = document.createElement('span');
            jpySpan.textContent = `¥${amount}`;
            fragment.appendChild(jpySpan);

            // CNY价格
            const cnySpan = document.createElement('span');
            cnySpan.className = 'booth-cny-price';
            cnySpan.textContent = ` (￥${cnyAmount})`;
            fragment.appendChild(cnySpan);

            // 添加尾随文本
            const trailing = `${trailing1 || ''}${tildeStr}${trailing2 || ''}`;
            if (trailing) {
              fragment.appendChild(document.createTextNode(trailing));
            }

            // 替换原节点
            textNode.parentNode.replaceChild(fragment, textNode);
          }
        }

        // 安全地标记为已处理
        if (textNode.parentNode && textNode.parentNode.dataset) {
          textNode.parentNode.dataset.priceProcessed = 'true';
        }
      }
    } catch (error) {
      console.error('处理常规价格时出错:', error);
    }
  };

  // 处理所有价格
  const processAllPrices = () => {
    try {
      // 先处理筛选器
      processPriceFilter();

      // 再处理常规价格文本
      processRegularPrices();
    } catch (error) {
      console.error('处理价格时发生未捕获错误:', error);
    }
  };

  // 监听DOM变化
  const observer = new MutationObserver(mutations => {
    // 延迟50ms执行处理，避免频繁触发
    setTimeout(processAllPrices, 50);
  });

  // 页面初始化
  const initialize = () => {
    try {
      // 处理当前页面价格
      processAllPrices();

      // 开始监听DOM变化
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: false
      });

      // 对于AJAX加载内容，设置定期检查
      setInterval(processAllPrices, 1500);
    } catch (error) {
      console.error('初始化脚本时出错:', error);
    }
  };

  // 根据页面加载状态决定何时初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }
})();
