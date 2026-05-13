import { Spin, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';

import { ApiClientError, fetchApiAssetObjectUrl, resolveApiAssetUrl } from '../services/apiClient';

export type ProtectedScreenshotImageState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'need_reason'
  | 'missing'
  | 'retention_deleted'
  | 'forbidden'
  | 'error';

type ProtectedScreenshotImageProps = {
  imageUri?: string | null;
  thumbUri?: string | null;
  accessReason?: string;
  alt: string;
  fit?: 'contain' | 'cover';
  minHeight?: number;
  className?: string;
  onStateChange?: (state: ProtectedScreenshotImageState) => void;
};

type AssetState = {
  state: ProtectedScreenshotImageState;
  src: string | null;
  message?: string;
};

const stateTitleMap: Record<ProtectedScreenshotImageState, string> = {
  idle: '等待加载',
  loading: '正在加载截图',
  ready: '截图已加载',
  need_reason: '请先填写截图查看原因',
  missing: '当前没有可展示的截图文件',
  retention_deleted: '截图文件已被保留策略删除',
  forbidden: '当前账号没有查看图片的权限',
  error: '截图加载失败'
};

export function ProtectedScreenshotImage({
  imageUri,
  thumbUri,
  accessReason,
  alt,
  fit = 'contain',
  minHeight = 260,
  className,
  onStateChange
}: ProtectedScreenshotImageProps) {
  const assetUri = imageUri ?? thumbUri ?? null;
  const normalizedReason = accessReason?.trim() ?? '';
  const requiresReason = Boolean(assetUri?.startsWith('/api/screenshots/'));
  const [asset, setAsset] = useState<AssetState>(() => buildInitialState(assetUri, requiresReason, normalizedReason));

  useEffect(() => {
    onStateChange?.(asset.state);
  }, [asset.state, onStateChange]);

  useEffect(() => {
    const initial = buildInitialState(assetUri, requiresReason, normalizedReason);
    setAsset(initial);

    if (!assetUri || initial.state === 'need_reason' || initial.state === 'missing') {
      return undefined;
    }

    if (!requiresReason) {
      setAsset({
        state: 'ready',
        src: resolveApiAssetUrl(assetUri),
        message: undefined
      });
      return undefined;
    }

    let active = true;
    let objectUrl: string | null = null;
    setAsset({ state: 'loading', src: null });

    fetchApiAssetObjectUrl(assetUri, normalizedReason)
      .then((url) => {
        if (!active) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setAsset({ state: 'ready', src: url });
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        setAsset(resolveErrorState(error));
      });

    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [assetUri, normalizedReason, requiresReason]);

  const shellStyle = useMemo(() => ({ minHeight }), [minHeight]);

  return (
    <div
      className={['protected-screenshot', className, `protected-screenshot--${fit}`].filter(Boolean).join(' ')}
      style={shellStyle}
    >
      {asset.state === 'ready' && asset.src ? (
        <img src={asset.src} alt={alt} className="protected-screenshot__image" />
      ) : asset.state === 'loading' ? (
        <div className="protected-screenshot__placeholder">
          <Spin />
          <Typography.Text type="secondary">正在加载截图…</Typography.Text>
        </div>
      ) : (
        <div className="protected-screenshot__placeholder">
          <Typography.Text strong>{stateTitleMap[asset.state]}</Typography.Text>
          {asset.message ? <Typography.Text type="secondary">{asset.message}</Typography.Text> : null}
        </div>
      )}
    </div>
  );
}

function buildInitialState(assetUri: string | null, requiresReason: boolean, accessReason: string): AssetState {
  if (!assetUri) {
    return {
      state: 'missing',
      src: null,
      message: '接口只返回了截图元数据，没有返回可展示的图片文件。'
    };
  }

  if (requiresReason && !accessReason) {
    return {
      state: 'need_reason',
      src: null,
      message: '填写查看原因后，才能读取原图或缩略图。'
    };
  }

  return {
    state: 'idle',
    src: null
  };
}

function resolveErrorState(error: unknown): AssetState {
  if (error instanceof ApiClientError) {
    if (error.status === 404) {
      return {
        state: 'retention_deleted',
        src: null,
        message: '文件可能已按保留策略删除，但元数据和风险记录仍可继续查看。'
      };
    }

    if (error.status === 400) {
      return {
        state: 'need_reason',
        src: null,
        message: '接口要求提供非空的截图查看原因。'
      };
    }

    if (error.status === 401 || error.status === 403) {
      return {
        state: 'forbidden',
        src: null,
        message: '当前账号缺少 screenshots.image.view 权限。'
      };
    }

    return {
      state: 'error',
      src: null,
      message: error.message
    };
  }

  return {
    state: 'error',
    src: null,
    message: '截图文件读取失败，请稍后重试。'
  };
}
