/**
 * Minimal react-native type shim so `bun run typecheck:panels-rn` works
 * without installing the (very large) react-native package. Runtime
 * consumers (the sorti host app) provide the REAL react-native — this repo
 * never bundles it; the shim only covers the handful of primitives the
 * example native panel uses. Installing react-native as a devDependency and
 * deleting this shim is also fine if you prefer exact types.
 */
declare module "react-native" {
  import type * as React from "react";

  export type StyleProp<T> = T | T[] | null | undefined;
  export type ViewStyle = Record<string, unknown>;
  export type TextStyle = Record<string, unknown>;

  export interface ViewProps {
    style?: StyleProp<ViewStyle>;
    children?: React.ReactNode;
    testID?: string;
  }
  export interface TextProps {
    style?: StyleProp<TextStyle>;
    children?: React.ReactNode;
  }
  export interface PressableProps extends ViewProps {
    onPress?: () => void;
    disabled?: boolean;
  }

  export const View: React.ComponentType<ViewProps>;
  export const Text: React.ComponentType<TextProps>;
  export const Pressable: React.ComponentType<PressableProps>;

  export const StyleSheet: {
    create<T extends Record<string, ViewStyle | TextStyle>>(styles: T): T;
  };
}
